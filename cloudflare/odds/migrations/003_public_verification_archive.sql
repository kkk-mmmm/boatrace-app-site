CREATE TABLE IF NOT EXISTS public_verification_archive (race_key TEXT NOT NULL, cohort TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(race_key,cohort));
CREATE INDEX IF NOT EXISTS public_verification_date ON public_verification_archive(date);
