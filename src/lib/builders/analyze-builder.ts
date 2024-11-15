import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { FarcasterCast } from '../../database/farcaster-schema';
import { fetchEmbeddingSummaries, log } from '../queueLib';
import { RedisClientType } from 'redis';
import { Job } from 'bullmq';
import { CastWithParent } from '../../workers/builder-profile-worker';

const anthropic = createAnthropic({
  apiKey: `${process.env.ANTHROPIC_API_KEY}`,
});

const BATCH_SIZE = 250; // Process 250 casts at a time

export async function generateBuilderProfile(
  casts: CastWithParent[],
  redisClient: RedisClientType,
  job: Job
) {
  // filter out casts that are not original posts and have no meaningful content
  const sortedCasts = casts.filter(
    (cast) =>
      !(
        cast.parentHash !== null &&
        (cast.text?.length || 0) <= 10 &&
        (!cast.embeds || JSON.parse(cast.embeds || '[]').length === 0)
      )
  );
  const castsText: string[] = [];

  // Process casts in batches
  for (let i = 0; i < sortedCasts.length; i += BATCH_SIZE) {
    const batchCasts = sortedCasts.slice(i, i + BATCH_SIZE);

    // Process batch concurrently
    const batchResults = await Promise.all(
      batchCasts.map(async (cast) => {
        if (!cast.timestamp || !cast.text) {
          throw new Error('Cast timestamp and text are required');
        }

        // Parse embeds JSON string into array of URLs
        const embedUrls = cast.embeds
          ? JSON.parse(cast.embeds).map((embed: { url: string }) => embed.url)
          : [];
        const embedSummaries = await fetchEmbeddingSummaries(
          redisClient,
          job,
          embedUrls
        );

        return `[${new Date(cast.timestamp).toISOString()}] ${cast.text}
    ${embedSummaries.length ? `Attachments: ${embedSummaries.join(', ')}` : ''}
    ${
      cast.parentCast?.text
        ? `This cast is a reply to: ${cast.parentCast.text} from @${cast.parentCast.parentFname} `
        : ''
    }
    ---`;
      })
    );

    castsText.push(...batchResults);
  }

  const message = castsText.join('\n');

  if (!message) throw new Error('No message to analyze');

  log(`Analyzing ${castsText.length} casts`, job);

  try {
    const { text } = await generateText({
      model: anthropic('claude-3-sonnet-20240229'),
      messages: [
        {
          role: 'system',
          content: `Analyze the chronological list of posts and their attachments to create a comprehensive builder profile. The analysis should be organized into the following sections:

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
  Feel free to add anything else that you think is relevant to help the builder achieve their wildest dreams.`,
        },
        {
          role: 'user',
          content: castsText.join('\n'),
        },
      ],
      maxTokens: 4000,
    });

    return text;
  } catch (error) {
    console.error('Error generating builder profile:', error);
    throw error;
  }
}
