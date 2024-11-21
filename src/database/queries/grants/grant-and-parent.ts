import { flowsDb } from '../../flowsDb';
import { grant } from '../../flows-schema';
import { eq } from 'drizzle-orm';

export const getGrantAndParentGrant = async (grantId: string) => {
  const grantResult = await flowsDb
    .select()
    .from(grant)
    .where(eq(grant.id, grantId))
    .execute();

  if (!grantResult || grantResult.length === 0) {
    return {
      grant: null,
      parentGrant: null,
    };
  }

  const grantData = grantResult[0];

  // Get parent grant if this is not a top level grant
  let parentGrant = null;
  if (!grantData.isTopLevel) {
    const parentGrantResult = await flowsDb
      .select()
      .from(grant)
      .where(eq(grant.id, grantData.flowId))
      .execute();

    if (parentGrantResult && parentGrantResult.length > 0) {
      parentGrant = parentGrantResult[0];
    }
  }

  return {
    grant: grantData,
    parentGrant,
  };
};
