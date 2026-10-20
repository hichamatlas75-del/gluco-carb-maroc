-- ============================================================================
-- GLUCOSCAN MAROC — SCHÉMA DE PRODUCTION SUPABASE (PostgreSQL + RLS)
-- ============================================================================
-- Exécutez ce script dans l'éditeur SQL de votre projet Supabase (Dashboard -> SQL Editor)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Énumérations
DO $$ BEGIN
    CREATE TYPE user_mode_enum AS ENUM ('insulin', 'wellness');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE meal_time_enum AS ENUM ('matin', 'midi', 'soir', 'collation');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Table profiles (Liée à auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    
    -- Mode d'utilisation (Double profil)
    user_mode user_mode_enum NOT NULL DEFAULT 'insulin',
    
    -- Objectifs nutritionnels journaliers
    target_carbs_g NUMERIC(5,1) NOT NULL DEFAULT 120.0 CHECK (target_carbs_g >= 10.0),
    target_proteins_g NUMERIC(5,1) NOT NULL DEFAULT 100.0 CHECK (target_proteins_g >= 20.0),
    
    -- Paramètres Diabète & Insuline (Mode 'insulin')
    ratio_morning NUMERIC(4,2) DEFAULT 8.0 CHECK (ratio_morning > 0),
    ratio_noon NUMERIC(4,2) DEFAULT 10.0 CHECK (ratio_noon > 0),
    ratio_evening NUMERIC(4,2) DEFAULT 10.0 CHECK (ratio_evening > 0),
    fsi_sensitivity NUMERIC(5,1) DEFAULT 50.0 CHECK (fsi_sensitivity > 0),
    target_glycemia NUMERIC(5,1) DEFAULT 100.0 CHECK (target_glycemia > 0),
    
    -- Paramètres Jeûne Intermittent (Mode 'wellness' & '18/6')
    fasting_start_hour SMALLINT DEFAULT 16 CHECK (fasting_start_hour BETWEEN 0 AND 23),
    fasting_end_hour SMALLINT DEFAULT 10 CHECK (fasting_end_hour BETWEEN 0 AND 23),
    
    daily_scans_count INTEGER NOT NULL DEFAULT 0,
    last_scan_date DATE DEFAULT CURRENT_DATE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Table moroccan_foods_ref (Aliments marocains calibrés)
CREATE TABLE IF NOT EXISTS public.moroccan_foods_ref (
    id TEXT PRIMARY KEY,
    name_fr TEXT NOT NULL,
    name_ar TEXT,
    category TEXT NOT NULL CHECK (category IN ('pains', 'plats', 'feculents', 'sucres', 'proteines', 'boissons', 'legumes')),
    
    carbs_100g NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    protein_100g NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    fiber_100g NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    fat_100g NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    glycemic_index SMALLINT NOT NULL DEFAULT 50 CHECK (glycemic_index BETWEEN 0 AND 100),
    
    default_portion_g INTEGER NOT NULL DEFAULT 100,
    max_safe_portion_g INTEGER NOT NULL DEFAULT 250,
    portion_unit TEXT NOT NULL DEFAULT 'g',
    portion_description TEXT,
    
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- 4. Table meals (Repas journalisés)
CREATE TABLE IF NOT EXISTS public.meals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    meal_time meal_time_enum NOT NULL,
    title TEXT NOT NULL,
    
    portion_total_weight_g NUMERIC(6,1) NOT NULL DEFAULT 0.0,
    net_carbs_g NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    proteins_g NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    fibers_g NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    fat_g NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    glycemic_index_avg SMALLINT NOT NULL DEFAULT 50,
    glycemic_load NUMERIC(5,1) NOT NULL DEFAULT 0.0,
    
    -- Ratio d'amorti : (Proteines + Fibres) / Glucides
    glycemic_buffer_ratio NUMERIC(4,2) GENERATED ALWAYS AS (
        CASE WHEN net_carbs_g > 0 THEN ((proteins_g + fibers_g) / net_carbs_g)
             ELSE 3.0 END
    ) STORED,
    
    glycemia_before NUMERIC(5,1),
    bolus_calculated NUMERIC(4,1),
    bolus_injected NUMERIC(4,1),
    
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    image_url TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. Index
CREATE INDEX IF NOT EXISTS idx_meals_user_created ON public.meals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_user_mode ON public.profiles(user_mode);
CREATE INDEX IF NOT EXISTS idx_moroccan_foods_cat ON public.moroccan_foods_ref(category);

-- 6. Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moroccan_foods_ref ENABLE ROW LEVEL SECURITY;

-- Politiques PROFILES
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leur propre profil" ON public.profiles;
CREATE POLICY "Les utilisateurs peuvent lire leur propre profil"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Les utilisateurs peuvent modifier leur propre profil" ON public.profiles;
CREATE POLICY "Les utilisateurs peuvent modifier leur propre profil"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- Politiques MEALS
DROP POLICY IF EXISTS "Les utilisateurs gerent uniquement leurs repas" ON public.meals;
CREATE POLICY "Les utilisateurs gerent uniquement leurs repas"
    ON public.meals FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Politiques MOROCCAN_FOODS_REF (Lecture publique)
DROP POLICY IF EXISTS "Catalogue marocain consultable par tous" ON public.moroccan_foods_ref;
CREATE POLICY "Catalogue marocain consultable par tous"
    ON public.moroccan_foods_ref FOR SELECT
    TO authenticated, anon
    USING (is_active = true);

-- 7. Trigger création automatique profil lors de l'inscription Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 8. Aliments marocains initiaux
INSERT INTO public.moroccan_foods_ref 
(id, name_fr, name_ar, category, carbs_100g, protein_100g, fiber_100g, fat_100g, glycemic_index, default_portion_g, max_safe_portion_g, portion_unit)
VALUES
('khobz-dar', 'Khobz Dar Artisanal', 'خبز الدار', 'pains', 45.0, 8.5, 3.5, 1.5, 68, 70, 200, '1/4 de pain (~70g)'),
('batbout', 'Batbout Marocain', 'بطبوط', 'pains', 48.0, 9.0, 3.0, 1.2, 70, 60, 180, '1 unite moyenne (~60g)'),
('msemen', 'Msemen Feuillete', 'مسمن', 'pains', 50.0, 7.5, 2.5, 16.0, 72, 85, 180, '1 piece (~85g)'),
('harcha', 'Harcha Semoule Pure', 'حرشة', 'pains', 52.0, 6.0, 2.0, 14.0, 75, 80, 160, '1 triangle (~80g)'),
('harira', 'Harira Traditionnelle', 'حريرة', 'plats', 14.5, 4.5, 2.8, 2.0, 50, 250, 450, '1 bol moyen (~250g)'),
('tagine-kefta', 'Tagine Kefta & Oeufs', 'طاجين الكفتة والبيض', 'plats', 2.8, 14.5, 1.2, 13.0, 30, 220, 400, '1 portion tajine (~220g)'),
('zaalouk', 'Zaalouk Aubergines & Tomates', 'زعلوك', 'legumes', 4.5, 1.5, 3.2, 6.0, 25, 120, 250, '1 coupelle (~120g)')
ON CONFLICT (id) DO NOTHING;

-- 9. Table app_accounts (Gestion de Profils simplifiés Pseudo + Mot de passe sans email)
CREATE TABLE IF NOT EXISTS public.app_accounts (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    user_mode TEXT NOT NULL DEFAULT 'insulin',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    history JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.app_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acces profils app_accounts" ON public.app_accounts;
CREATE POLICY "Acces profils app_accounts"
    ON public.app_accounts FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);
