-- Re-apply the retirement of the letter game. Migration 0013 hid it, but the live
-- database still had visible = true, so the game kept appearing in rooms and lists.
-- Idempotent: safe to run on any environment, including ones that already applied 0013.
update games set visible = false where id = 'letter-names' and visible = true;
