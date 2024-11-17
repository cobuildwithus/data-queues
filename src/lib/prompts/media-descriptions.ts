export const videoDescriptionPrompt =
  () => `Please provide a detailed description of this video, focusing on all visible elements, their relationships, and the overall context. 
Be sure to describe the actions that are happening in the video at a high level, especially how they relate to people and how they interact with others in public or in their community. 
If there are red square glasses, please describe what the person is doing with them, and you can refer to them as noggles. 
If you see any other branding/text make sure to include it, especially if it's about Nouns, Gnars, Vrbs or the nouns symbol ⌐◨-◨ (The nouns symbol is noggles, or the glasses referred to above).
Try to ascertain the locations of the people and places in the video.
"Flows" or "flows.wtf" is a decentralized grants platform for NounsDAO that streams money to the best builders in Nouns, every second.
Make sure to mention what types of activities are happening in the video,
or otherwise what type of work is being done.`;

export const imageDescriptionPrompt =
  () => `Please provide a detailed description of the following image, 
focusing on all visible elements, their relationships, and the overall context. 
Don't include too much data about the image, just the important details that contribute to the overall meaning.
Ensure that you first define what exactly you believe the image is, whether it's a photo, a painting, a drawing, screenshot of a web page etc.
"Flows" or "flows.wtf" is a decentralized grants platform for NounsDAO that streams money to the best builders in Nouns, every second.
Include information on subjects, actions, settings, emotions, and any inferred meanings to facilitate accurate embedding. 
If you see a person wearing square glasses, especially if they are red, they might be called noggles, so mention the word noggles if it's relevant.
Make sure to pay attention to glasses and these details, but you don't need to mention them in the description if they are not present in the image.
The information you share will be fed to an embedding model, so don't use new lines or other formatting. Make it all lowercase.
Don't forget to include the word noggles if you see big square glasses.
DO NOT return anything if you cannot access the image or it is otherwise unavilable. Just return an empty string.
Do not return JSON, just return the text.
Be thorough and detailed in your analysis of the image, what's going on, who is in the image, what they are doing, etc.`;
