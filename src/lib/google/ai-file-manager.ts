import { GoogleAIFileManager } from '@google/generative-ai/dist/server/server';
import { Job } from 'bullmq';
import { log } from '../helpers';

export async function uploadAndWaitForProcessing(
  fileManager: GoogleAIFileManager,
  tempFilePath: string,
  mimeType: string,
  job: Job
) {
  // Upload temp file to Google
  log('Uploading file to Google AI Studio', job);
  const uploadResponse = await fileManager.uploadFile(tempFilePath, {
    mimeType,
    displayName: 'File to analyze',
  });
  log('File uploaded successfully', job);

  // Check file state until processing is complete
  log('Waiting for file processing to complete', job);
  let file = await fileManager.getFile(uploadResponse.file.name);
  const maxRetries = 30; // e.g., wait for up to 5 minutes
  let retries = 0;

  while (file.state === 'PROCESSING' && retries < maxRetries) {
    log('File still processing, waiting 10 seconds...', job);
    await new Promise((resolve) => setTimeout(resolve, 10000));
    file = await fileManager.getFile(uploadResponse.file.name);
    retries++;
  }

  if (file.state === 'FAILED') {
    log('File processing failed', job);
    throw new Error('File processing failed');
  } else if (file.state === 'PROCESSING') {
    log('File processing timed out', job);
    throw new Error('File processing timed out');
  }

  log('File processing completed successfully', job);
  return uploadResponse;
}
