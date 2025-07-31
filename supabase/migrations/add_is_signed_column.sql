-- Add is_signed column to releases table
ALTER TABLE releases 
ADD COLUMN IF NOT EXISTS is_signed BOOLEAN DEFAULT true;

-- Update existing releases to be marked as signed (assuming they are)
UPDATE releases 
SET is_signed = true 
WHERE is_signed IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN releases.is_signed IS 'Indicates whether the release binary is code signed. True for production releases, false for unsigned test builds.';