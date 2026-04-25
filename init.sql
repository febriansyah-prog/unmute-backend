-- Updated Database Initialization Script for Unmute By Unifers

-- 1. Schools Table
CREATE TABLE IF NOT EXISTS schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_date DATE UNIQUE NOT NULL,
    school_id UUID REFERENCES schools(id) ON DELETE RESTRICT, -- Changed from CASCADE
    contact_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    status VARCHAR(50) DEFAULT 'Menunggu',
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraint: Prevent Weekends (0=Sunday, 6=Saturday)
    CONSTRAINT no_weekends CHECK (EXTRACT(DOW FROM booking_date) NOT IN (0, 6)),
    
    -- Constraint: Prevent Blocked Dates (Mei 1-4, Holidays, Bootcamp)
    CONSTRAINT blocked_dates CHECK (
        booking_date NOT IN (
            '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', -- Mei Blocked
            '2026-05-14', '2026-05-15', '2026-05-27', '2026-05-28', '2026-05-29', -- Mei Holidays
            '2026-06-01', '2026-06-16', -- Juni Holidays
            '2026-07-28', '2026-07-29', '2026-07-30', -- Bootcamp dates
            '2026-07-31' -- Juli Holidays
        )
    ),
    
    -- Constraint: Date Range (Mei - Juli 2026)
    CONSTRAINT valid_range CHECK (
        booking_date >= '2026-05-01' AND booking_date <= '2026-07-31'
    )
);

-- 3. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE'
    target_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
);

-- 4. Delegates Table
CREATE TABLE IF NOT EXISTS delegates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    nisn VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    topic VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
