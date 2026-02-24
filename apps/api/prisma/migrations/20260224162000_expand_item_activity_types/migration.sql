DO $$ BEGIN
  ALTER TYPE "ItemActivityType" ADD VALUE 'ITEM_CREATED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "ItemActivityType" ADD VALUE 'ITEM_UPDATED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "ItemActivityType" ADD VALUE 'IMAGE_UPLOADED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "ItemActivityType" ADD VALUE 'IMAGE_DELETED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "ItemActivityType" ADD VALUE 'IMAGES_REORDERED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
