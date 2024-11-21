export function getGrantUpdateCastPrompt(): string {
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

If the cast is about an activity, event, or work done by the grant recipient where others are involved, you can assume it's for larger community building efforts.

Do not set it as an update if the impact or work described in the cast is not being done by the grant recipient.

If the cast is about someone minting a token, unless they're clear that they also authored the media being minted, do not count it as a grant update.

If the cast is just a statement of commitment or enthusiasm without actual work/activity being done, do not count it as a grant update.
Statements that show enthusiasm but don't describe any actual work or progress should not be counted as grant updates.
The cast must describe concrete actions, progress, or tangible contributions related to the grant's goals.

Statements that only express:
- General enthusiasm
- Future intentions
- Motivational phrases
- Slogans or catchphrases
- Personal philosophies
Should not be counted as grant updates unless they are accompanied by descriptions of actual work or impact.

You will also be provided with the builder profile of the cast author. Use it to determine if the cast is a grant update, paying special attention to the projects the builder is involved in.
If you are not sure, err on the side of not counting it as a grant update, but understand that the builder profile might be a few days old.
`;
}
