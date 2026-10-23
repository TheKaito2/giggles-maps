-- Hand-checked chain stores the import missed. Supermarkets and convenience stores aren't detour stops
-- ("Mini Big C" showed up as a Local gem). Chain food courts and a KFC stay as meal stops but aren't local.
update public.places set detour = false, local = false
 where id in (9034, 3927, 124496, 11763, 25665, 42867, 25907, 44403, 10870);   -- 7-Eleven, Big C, Lotus's, Villa, Tesco Lotus
update public.places set local = false
 where id in (6901, 33222, 13219, 31496, 20640, 18544, 35344, 25753, 98708);   -- Big C / Lotus / Tesco / Makro food courts, KFC
