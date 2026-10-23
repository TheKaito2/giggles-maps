-- Places mislabelled as detour stops (hand-checked): a drug store, a bank, a 7-Eleven, a bike repair shop,
-- a road intersection and a hospital roundabout. They stay searchable, but plans never offer them.
update public.places set detour = false where id in (29467, 4255, 40608, 133899, 14300, 41686);
