-- Add in-review workflow status for human approval gates.
ALTER TYPE "ItemStatus" ADD VALUE 'in_review';

-- Add explicit review lifecycle activity types.
ALTER TYPE "ItemActivityType" ADD VALUE 'REVIEW_SUBMITTED';
ALTER TYPE "ItemActivityType" ADD VALUE 'REVIEW_APPROVED';
ALTER TYPE "ItemActivityType" ADD VALUE 'REVIEW_REJECTED';
