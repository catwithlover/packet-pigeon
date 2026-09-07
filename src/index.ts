import { Hono } from "hono";
import PostalMime from 'postal-mime';

interface Env {
	EMAIL: SendEmail;
  EMAIL_BUCKET: R2Bucket;
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/message", (c) => {
  return c.text("Hello Hono!");
});

export default {
  fetch: app.fetch,
  async email(message, env, ctx): Promise<void> {

    const workerReceivedAt = (new Date()).toISOString();
    const emailId = crypto.randomUUID();
    const envelopeFrom = message.from;
    const envelopeTo = message.to;
    const bucketKey = `raw/${emailId}.eml`;

    console.log(`Storing email to R2 bucket with key: ${bucketKey}`);

    // Stream the raw MIME directly into R2.
    // R2 requires a known-length stream, so wrap the incoming
    // email stream with FixedLengthStream using message.rawSize.
    const { readable, writable } = new FixedLengthStream(message.rawSize);

    const uploadPromise = env.EMAIL_BUCKET.put(
        bucketKey, 
        readable,
        {
          httpMetadata: {
            contentType: "message/rfc822",
          },
          customMetadata: {
            envelopeFrom,
            envelopeTo,
            emailId,
            workerReceivedAt,
          },
        }
    );

    const pipePromise = message.raw.pipeTo(writable);

    const [storedObject, pipeResult] = await Promise.all([uploadPromise, pipePromise]);

    console.log({storedObject, pipeResult});

    console.log(`Email stored successfully in R2 bucket with key: ${bucketKey}`);
  },

  async queue(batch, env, ctx): Promise<void> {

    for (const message of batch.messages) {
      console.log("Processing message:", JSON.stringify(message));
      const bucketKey = message.body.object.key;

      console.log(`Retrieving email from R2 bucket with key: ${bucketKey}`);
      const object = await env.EMAIL_BUCKET.get(bucketKey);
      if (!object) {
        console.error(`Failed to retrieve email from R2 bucket with key: ${bucketKey}`);
        continue;
      }
      const {emailId, envelopeFrom, envelopeTo, workerReceivedAt} = object.customMetadata;
      console.log("Retrieved object from R2 bucket:", JSON.stringify(object));

      // Read the raw email message from the R2 object
      const rawBuffer = await new Response(object.body).arrayBuffer();

      //Parse the raw email message
      const parser = new PostalMime();

      // Parse the raw email message
      const email = await parser.parse(rawBuffer);
      const {
        headers,
        from, sender, to, cc, bcc, replyTo, date,
        deliveredTo, returnPath,
        messageId,
        inReplyTo,
        references,
        subject,
        html,
        text,
        attachments,
       } = email;


      console.log({
        emailId, envelopeFrom, envelopeTo,
        headers,
        from, sender, to, cc, bcc, replyTo, date,
        deliveredTo, returnPath,
        messageId,
        inReplyTo,
        references,
        subject,
        html,
        text,
        attachments,
        workerReceivedAt,
       });

      for (const attachment of attachments) {
        const attachmentId = crypto.randomUUID();

        const {
          filename,
          mimeType,
          content,
          contentId
        } = attachment;

        const safeFilename = ( filename || "untitled" ).replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");

        const bucketKey = `attachments/${emailId}/${attachmentId}/${safeFilename}`;

        console.log({filename, mimeType, content, contentId})

        console.log(`Storing attachment to R2 bucket with key: ${bucketKey}`);

        await env.EMAIL_BUCKET.put(
            bucketKey, 
            content as ArrayBuffer,
            {
              httpMetadata: {
                contentType: attachment.mimeType,
              },
              customMetadata: {},
            }
        );

        console.log(`Attachment stored successfully in R2 bucket with key: ${bucketKey}`);
       }
    }



    // const headers = parentMessageId ? {
    //   // Threading
    //     "In-Reply-To": parentMessageId,
    //     "References": parentReferences ? ( parentReferences + " " + parentMessageId ) : parentMessageId,
    // } : {};

    // console.log({
		// 	to: email.from.address,
		// 	from: "ai@agent.asyncat.app",
    //   headers,
		// 	subject: "We received your message",
		// })

		// // Send auto-reply
		// const result = await env.EMAIL.send({
		// 	to: email.from.address,
		// 	from: "ai@agent.asyncat.app",
    //   headers,
		// 	subject: "We received your message",
		// 	html: "<h1>Thank you!</h1><p>We'll get back to you soon.</p><code>" + JSON.stringify(email) + "</code>",
		// });

    // console.log(result);
    // console.log(result.messageId)
	},
} satisfies ExportedHandler<Env>;