import { createLogger } from "@lib/cloudflare-logging";
import { getJob, updateJobState } from "@lib/jobs";
import { toGrayscale } from "@lib/image-processing";

const log = createLogger("queue-handler");

export interface JobMessage {
  jobId: string;
}

export async function handleQueue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const { jobId } = message.body;
    try {
      await processJob(jobId, env);
      message.ack();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      log.error("Job processing failed", { jobId, error: errorMessage });
      await updateJobState(env.DB, jobId, "failed", {
        error: errorMessage
      });
      message.retry();
    }
  }
}

async function processJob(jobId: string, env: Env): Promise<void> {
  log.info("Job received", { jobId });

  // Step 1: deliberate delay so the user sees "pending" in the UI.
  await scheduler.wait(10_000);

  // Step 2: transition to in_progress.
  await updateJobState(env.DB, jobId, "in_progress");
  log.info("Job in progress", { jobId });

  // Step 3: deliberate delay so the user sees "in_progress".
  await scheduler.wait(10_000);

  // Step 4: actually process.
  const job = await getJob(env.DB, jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  const original = await env.IMAGES_BUCKET.get(job.originalKey);
  if (!original) {
    throw new Error(`Original object missing: ${job.originalKey}`);
  }

  const inputBytes = new Uint8Array(await original.arrayBuffer());
  const outputBytes = toGrayscale(inputBytes);

  const processedKey = `processed/${jobId}.png`;
  await env.IMAGES_BUCKET.put(processedKey, outputBytes, {
    httpMetadata: { contentType: "image/png" }
  });

  await updateJobState(env.DB, jobId, "completed", { processedKey });
  log.info("Job completed", { jobId, processedKey });
}
