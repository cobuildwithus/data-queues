import { OpenAI } from 'openai';

// Initialize the OpenAI client with your API key
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure your API key is stored securely
});

/**
 * Analyzes an image from a URL and returns a description.
 * @param imageUrl - The URL of the image to analyze.
 * @returns A promise that resolves to the description of the image.
 */
export async function describeImage(imageUrl: string): Promise<string> {
  try {
    // Create a chat completion request with the image URL
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Please provide a detailed description of the following image, 
                focusing on all visible elements, their relationships, and the overall context. 
                Don't include too much data about the image, just the important details that contribute to the overall meaning.
                Ensure that you first define what exactly you believe the image is, whether it's a photo, a painting, a drawing, screenshot of a web page etc.
                Include information on subjects, actions, settings, emotions, and any inferred meanings to facilitate accurate embedding. 
                If you see a person wearing square glasses, especially if they are red, they might be called noggles. 
                Make sure to pay attention to glasses and these details, but you don't need to mention them in the description if they are not present in the image.
                The information you share will be fed to an embedding model, so don't use new lines or other formatting. Make it all lowercase.`,
            },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    });

    // Extract and return the assistant's response
    const description = response.choices[0]?.message?.content;
    console.log({ description, imageUrl });
    return description || 'No description available.';
  } catch (error: any) {
    if (error.code === 'invalid_image_url') {
      console.error('Invalid image URL', imageUrl);
    } else if (error.code === 'invalid_image_format') {
      console.error('Invalid image format', imageUrl);
    } else {
      console.error('Error describing image');
      console.error(error, imageUrl);
    }
    throw new Error('Failed to describe image.');
  }
}
