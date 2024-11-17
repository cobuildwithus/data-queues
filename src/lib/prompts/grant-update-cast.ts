export function getGrantUpdateCastPrompt({
  grantId,
  grantDescription,
  parentFlowDescription,
  attachmentSummaries = [],
}: {
  grantId: string;
  grantDescription: string;
  parentFlowDescription: string;
  attachmentSummaries?: string[];
}): string {
  return `You will need to determine if the cast is a status update for the grant. 
If it is, you will need to return the grantId and your confidence score why you think this cast is an update for this specific grant. 
If the cast is not a grant update - return an empty grantId. 
If the cast is generic comment about grants program - return an empty grantId. 
Feel free to infer or otherwise make basic logical assumptions to determine if the cast is a grant update. 
Eg: if someone posts about buying supplies but doesn't mention the grant, you can assume it's an update for the grant. 
The cast includes some images.
Pay special attention to the requirements of the parent flow, which dictate what types of work are eligible for the grant, and should
inform whether or not the cast should be counted as an update on work done for the grant.
If the cast content is not provided, there must be attachments to determine if it's a grant update.
If the grant description has some details about side projects or other work the builder is involved in,
you should make sure not to count any information in the cast that relates to that side work.
The cast must be specifically related to the grant to be counted as an update.
For context, Nouns is the parent DAO that funds flows. There are sub-daos within Nouns that are like 
mini subcultures that focus on different things. Gnars DAO is an extreme sports sub-dao that funds athletes like skaters, surfers, etc.
Vrbs is a public-good and artists focused sub-dao that funds people and projects making local impact.
If the cast is about work within one of these sub-cultures, you can assume it counts for the larger Nouns community, assuming the work is related to the grant.

Grant Details:
Grant ID: ${grantId}
Description: ${grantDescription}
Parent Flow Description: ${parentFlowDescription}
Pay special attention to the following attachments posted by the user. 
The attachments are either videos or images, and you should use them to determine if the cast is a grant update.
They are described below:
${
  attachmentSummaries.length
    ? `The update contains the following attachments posted by the user: ${attachmentSummaries.join(
        ', '
      )}`
    : 'The update contains no attachments'
}

**Instructions:**
Please output your answer as a *JSON object* that matches the following schema:
\`\`\`json
{
  "grantId": string (optional),
  "isGrantUpdate": boolean,
  "reason": string,
  "confidenceScore": number
}
\`\`\`

**Do not include any additional text or explanations. Provide only the JSON object as your output.**`;
}
