export const builderProfilePrompt =
  () => `Analyze the chronological list of posts and their attachments to create a comprehensive builder profile. The analysis should be organized into the following sections:

Project History:
- Timeline of projects with dates
- Major launches and milestones
- Current project status
- Key results

Collaboration Network:
- Regular collaborators
- Partnerships
- Mentorship relationships
- Community connections

Funding & Resources:
- Grants received/given
- Tools and platforms used
- Communities leveraged
- Resource patterns

Problem-Solution Patterns:
- Common problems addressed
- Solution approaches
- Successful strategies
- Recurring challenges

Impact & Metrics:
- Quantitative metrics
- Qualitative successes
- Community feedback
- Real-world impact

Key Technologies/Protocols:
- Core technologies used
- Industry-specific tools
- Digital platforms
- Hardware/equipment
- Software solutions
- Communication tools
- Production methods
- Distribution systems

Communication Style:
- Update frequency
- Documentation approach
- Engagement patterns
- Voice and tone

Growth Trajectory:
- Skills development
- Expanding impact
- New communities
- Project scope evolution

Philosophy:
- Core values
- Beliefs
- Motivations
- Vision

Future Direction:
- Stated goals
- Problems to solve
- Target communities
- Skills development

Use direct references from posts where possible. 
Include relevant links and describe any media attachments. 
Focus on identifying patterns that show their building approach, unique qualities, and main contributions.
Ensure to try to be accurate about the month and year if referencing dates.
Do not make assumptions about passed proposals or projects, just state the facts.
Do not make assumptions, feel free to leave sections blank if you don't have enough information.
You do not need to say that you don't have enough information, just leave the section content blank, but keep the header.
If you need to include a lot of source information in certain sections to get the full picture, feel free to do so.
Feel free to add anything else that you think is relevant to help the builder achieve their wildest dreams.
Analyze the builder's profile as a whole, not just the individual posts.`;

export const videoDescriptionPrompt =
  () => `Please provide a detailed description of this video, focusing on all visible elements, their relationships, and the overall context. 
Be sure to describe the actions that are happening in the video at a high level, especially how they relate to people and how they interact with others in public or in their community. 
If there are red square glasses, please describe what the person is doing with them, and you can refer to them as noggles. 
If you see any other branding/text make sure to include it, especially if it's about Nouns, Gnars, Vrbs or the nouns symbol ⌐◨-◨.
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
DO NOT return anything if you cannot access the image or it is otherwise unavilable. Just return an empty string.`;
