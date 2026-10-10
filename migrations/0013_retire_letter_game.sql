-- Retire the letter game ("اسم ولد بنت جماد حيوان بلد"). It was removed from the catalogue and
-- must not appear on any room route. Hiding (not deleting) keeps old room history intact.
update games set visible = false where id = 'letter-names';
