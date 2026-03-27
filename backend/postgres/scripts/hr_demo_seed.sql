-- =============================================================================
-- DataPilot – HR demo dataset for local PostgreSQL
-- =============================================================================
-- Run in psql, DBeaver, or any Postgres client connected to your database:
--   psql -U your_user -d your_database -f hr_demo_seed.sql
--
-- After load, point DataPilot demo Postgres at this database and set:
--   DEMO_POSTGRES_SCHEMA=hr
--
-- Idempotent: drops and recreates schema `hr` (all objects below live in `hr`).
-- =============================================================================

BEGIN;

DROP SCHEMA IF EXISTS hr CASCADE;
CREATE SCHEMA hr;

SET search_path TO hr, public;

-- -----------------------------------------------------------------------------
-- Core dimensions
-- -----------------------------------------------------------------------------

CREATE TABLE hr.departments (
  department_id   SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  code            VARCHAR(16)  NOT NULL UNIQUE,
  location_city   VARCHAR(80)  NOT NULL,
  country         VARCHAR(64)  NOT NULL DEFAULT 'United States',
  annual_budget   NUMERIC(14, 2),
  opened_on       DATE NOT NULL DEFAULT DATE '2015-01-01'
);

COMMENT ON TABLE hr.departments IS 'Organizational units (cost centers) with location and budget.';
COMMENT ON COLUMN hr.departments.annual_budget IS 'Planned annual operating budget in USD.';

CREATE TABLE hr.job_roles (
  job_role_id     SERIAL PRIMARY KEY,
  title           VARCHAR(120) NOT NULL,
  job_family      VARCHAR(64)  NOT NULL, -- e.g. Engineering, Sales, HR
  career_level    VARCHAR(32)  NOT NULL, -- IC, Senior, Lead, Manager, Director
  pay_band_min    NUMERIC(12, 2) NOT NULL,
  pay_band_max    NUMERIC(12, 2) NOT NULL,
  is_manager_track BOOLEAN NOT NULL DEFAULT FALSE
);

COMMENT ON TABLE hr.job_roles IS 'Job catalog with pay bands; links to employees.current role.';

CREATE TABLE hr.employees (
  employee_id       SERIAL PRIMARY KEY,
  employee_number   VARCHAR(16) NOT NULL UNIQUE,
  first_name        VARCHAR(80) NOT NULL,
  last_name         VARCHAR(80) NOT NULL,
  email             VARCHAR(160) NOT NULL UNIQUE,
  phone             VARCHAR(32),
  hire_date         DATE NOT NULL,
  termination_date  DATE,
  employment_status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (employment_status IN ('active', 'leave', 'terminated')),
  department_id     INTEGER NOT NULL REFERENCES hr.departments (department_id),
  job_role_id       INTEGER NOT NULL REFERENCES hr.job_roles (job_role_id),
  manager_id        INTEGER REFERENCES hr.employees (employee_id),
  birth_date        DATE,
  gender            VARCHAR(16),
  city              VARCHAR(80) NOT NULL,
  country           VARCHAR(64) NOT NULL DEFAULT 'United States'
);

COMMENT ON TABLE hr.employees IS 'Workforce roster; manager_id is self-referential (reporting line).';
COMMENT ON COLUMN hr.employees.employment_status IS 'active, leave, or terminated.';

CREATE INDEX idx_employees_department ON hr.employees (department_id);
CREATE INDEX idx_employees_manager ON hr.employees (manager_id);
CREATE INDEX idx_employees_status ON hr.employees (employment_status);

-- -----------------------------------------------------------------------------
-- Facts / events HR cares about
-- -----------------------------------------------------------------------------

CREATE TABLE hr.compensation_history (
  compensation_id SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES hr.employees (employee_id) ON DELETE CASCADE,
  effective_date  DATE NOT NULL,
  base_salary_annual NUMERIC(12, 2) NOT NULL,
  currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
  bonus_eligible  BOOLEAN NOT NULL DEFAULT FALSE,
  notes           VARCHAR(500)
);

COMMENT ON TABLE hr.compensation_history IS 'Point-in-time annual base salary changes.';

CREATE UNIQUE INDEX uq_comp_employee_effective ON hr.compensation_history (employee_id, effective_date);

CREATE TABLE hr.leave_requests (
  leave_request_id SERIAL PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES hr.employees (employee_id) ON DELETE CASCADE,
  request_type     VARCHAR(32) NOT NULL
    CHECK (request_type IN ('pto', 'sick', 'parental', 'unpaid', 'other')),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  hours_requested  NUMERIC(6, 2) NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by_id   INTEGER REFERENCES hr.employees (employee_id)
);

COMMENT ON TABLE hr.leave_requests IS 'Time-off requests with approval workflow.';

CREATE INDEX idx_leave_employee ON hr.leave_requests (employee_id);
CREATE INDEX idx_leave_dates ON hr.leave_requests (start_date, end_date);

CREATE TABLE hr.performance_reviews (
  review_id        SERIAL PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES hr.employees (employee_id) ON DELETE CASCADE,
  reviewer_id      INTEGER NOT NULL REFERENCES hr.employees (employee_id),
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  overall_rating   NUMERIC(3, 2) NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
  goals_met_pct    NUMERIC(5, 2),
  promotion_ready  BOOLEAN NOT NULL DEFAULT FALSE,
  summary          TEXT
);

COMMENT ON TABLE hr.performance_reviews IS 'Periodic performance ratings and promotion flags.';

CREATE INDEX idx_reviews_employee ON hr.performance_reviews (employee_id);

CREATE TABLE hr.training_completions (
  completion_id    SERIAL PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES hr.employees (employee_id) ON DELETE CASCADE,
  course_code      VARCHAR(32) NOT NULL,
  course_name      VARCHAR(160) NOT NULL,
  completed_on     DATE NOT NULL,
  score_pct        NUMERIC(5, 2),
  is_mandatory     BOOLEAN NOT NULL DEFAULT FALSE
);

COMMENT ON TABLE hr.training_completions IS 'LMS-style course completions for compliance and upskilling.';

CREATE INDEX idx_training_employee ON hr.training_completions (employee_id);

-- -----------------------------------------------------------------------------
-- Seed: departments
-- -----------------------------------------------------------------------------

INSERT INTO hr.departments (name, code, location_city, country, annual_budget, opened_on) VALUES
  ('People & Culture', 'HR', 'Chicago', 'United States', 2400000.00, DATE '2016-03-01'),
  ('Engineering', 'ENG', 'Austin', 'United States', 18500000.00, DATE '2015-01-01'),
  ('Sales', 'SLS', 'New York', 'United States', 4200000.00, DATE '2015-06-15'),
  ('Finance', 'FIN', 'Chicago', 'United States', 3100000.00, DATE '2015-01-01'),
  ('Customer Success', 'CS', 'Denver', 'United States', 5600000.00, DATE '2017-09-01');

-- -----------------------------------------------------------------------------
-- Seed: job roles
-- -----------------------------------------------------------------------------

INSERT INTO hr.job_roles (title, job_family, career_level, pay_band_min, pay_band_max, is_manager_track) VALUES
  ('HR Business Partner', 'HR', 'Senior', 95000, 130000, FALSE),
  ('Director of Engineering', 'Engineering', 'Director', 185000, 245000, TRUE),
  ('Software Engineer', 'Engineering', 'IC', 110000, 155000, FALSE),
  ('Senior Software Engineer', 'Engineering', 'Senior', 145000, 195000, FALSE),
  ('Engineering Manager', 'Engineering', 'Manager', 165000, 210000, TRUE),
  ('Account Executive', 'Sales', 'IC', 85000, 120000, FALSE),
  ('Sales Manager', 'Sales', 'Manager', 120000, 165000, TRUE),
  ('Financial Analyst', 'Finance', 'IC', 72000, 98000, FALSE),
  ('Controller', 'Finance', 'Director', 140000, 175000, TRUE),
  ('Customer Success Manager', 'Customer Success', 'IC', 78000, 105000, FALSE);

-- -----------------------------------------------------------------------------
-- Seed: employees (managers first — no manager_id; then ICs)
-- -----------------------------------------------------------------------------

INSERT INTO hr.employees (
  employee_number, first_name, last_name, email, phone, hire_date, employment_status,
  department_id, job_role_id, manager_id, birth_date, gender, city, country
) VALUES
  ('E10001', 'Jordan', 'Lee', 'jordan.lee@example.com', '555-0101', DATE '2018-02-01', 'active', 2, 5, NULL, DATE '1985-04-12', 'non-binary', 'Austin', 'United States'),
  ('E10002', 'Samira', 'Patel', 'samira.patel@example.com', '555-0102', DATE '2017-05-15', 'active', 2, 2, NULL, DATE '1982-11-03', 'female', 'Austin', 'United States'),
  ('E10003', 'Marcus', 'Wright', 'marcus.wright@example.com', '555-0103', DATE '2019-01-10', 'active', 3, 7, NULL, DATE '1988-07-22', 'male', 'New York', 'United States'),
  ('E10004', 'Elena', 'Vargas', 'elena.vargas@example.com', '555-0104', DATE '2016-08-01', 'active', 4, 9, NULL, DATE '1980-02-28', 'female', 'Chicago', 'United States'),
  ('E10005', 'Priya', 'Nair', 'priya.nair@example.com', '555-0105', DATE '2019-03-18', 'active', 1, 1, NULL, DATE '1990-09-14', 'female', 'Chicago', 'United States');

-- ICs and specialists (report to managers above)
INSERT INTO hr.employees (
  employee_number, first_name, last_name, email, phone, hire_date, employment_status,
  department_id, job_role_id, manager_id, birth_date, gender, city, country
) VALUES
  ('E10101', 'Alex', 'Chen', 'alex.chen@example.com', '555-0201', DATE '2021-04-05', 'active', 2, 3, 1, DATE '1995-01-20', 'male', 'Austin', 'United States'),
  ('E10102', 'Blake', 'Morris', 'blake.morris@example.com', '555-0202', DATE '2020-07-12', 'active', 2, 4, 1, DATE '1992-05-08', 'male', 'Austin', 'United States'),
  ('E10103', 'Casey', 'Nguyen', 'casey.nguyen@example.com', '555-0203', DATE '2022-01-17', 'active', 2, 3, 1, DATE '1996-12-01', 'female', 'Remote', 'United States'),
  ('E10104', 'Dana', 'Okonkwo', 'dana.okonkwo@example.com', '555-0204', DATE '2019-11-01', 'active', 2, 4, 2, DATE '1991-03-15', 'female', 'Austin', 'United States'),
  ('E10105', 'Elliot', 'Park', 'elliot.park@example.com', '555-0205', DATE '2023-02-27', 'active', 2, 3, 1, DATE '1998-08-30', 'male', 'Austin', 'United States'),
  ('E10201', 'Frankie', 'Reyes', 'frankie.reyes@example.com', '555-0301', DATE '2020-03-09', 'active', 3, 6, 3, DATE '1993-10-11', 'non-binary', 'New York', 'United States'),
  ('E10202', 'Greta', 'Silva', 'greta.silva@example.com', '555-0302', DATE '2021-09-20', 'active', 3, 6, 3, DATE '1994-04-25', 'female', 'New York', 'United States'),
  ('E10203', 'Hassan', 'Ibrahim', 'hassan.ibrahim@example.com', '555-0303', DATE '2018-06-04', 'terminated', 3, 6, 3, DATE '1989-01-07', 'male', 'New York', 'United States'),
  ('E10301', 'Iris', 'Kowalski', 'iris.kowalski@example.com', '555-0401', DATE '2020-01-06', 'active', 4, 8, 4, DATE '1995-06-18', 'female', 'Chicago', 'United States'),
  ('E10302', 'Jamal', 'Thompson', 'jamal.thompson@example.com', '555-0402', DATE '2022-05-16', 'active', 4, 8, 4, DATE '1997-02-02', 'male', 'Chicago', 'United States'),
  ('E10401', 'Kim', 'Andersson', 'kim.andersson@example.com', '555-0501', DATE '2021-08-23', 'leave', 5, 10, NULL, DATE '1992-11-29', 'female', 'Denver', 'United States'),
  ('E10402', 'Logan', 'Brooks', 'logan.brooks@example.com', '555-0502', DATE '2019-10-14', 'active', 5, 10, NULL, DATE '1990-07-07', 'male', 'Denver', 'United States'),
  ('E10403', 'Morgan', 'Diaz', 'morgan.diaz@example.com', '555-0503', DATE '2023-04-03', 'active', 5, 10, NULL, DATE '1999-03-21', 'non-binary', 'Denver', 'United States');

UPDATE hr.employees SET termination_date = DATE '2024-03-31' WHERE employee_number = 'E10203';

-- Optional: tie CS employees to a manager (Logan manages Kim/Morgan)
UPDATE hr.employees SET manager_id = (SELECT employee_id FROM hr.employees WHERE employee_number = 'E10402')
WHERE employee_number IN ('E10401', 'E10403');

-- -----------------------------------------------------------------------------
-- Seed: compensation, leave, reviews, training
-- -----------------------------------------------------------------------------

INSERT INTO hr.compensation_history (employee_id, effective_date, base_salary_annual, bonus_eligible)
SELECT e.employee_id, e.hire_date, jr.pay_band_min + (random() * (jr.pay_band_max - jr.pay_band_min) * 0.25)::NUMERIC(12,2), jr.is_manager_track OR random() > 0.6
FROM hr.employees e
JOIN hr.job_roles jr ON jr.job_role_id = e.job_role_id;

INSERT INTO hr.compensation_history (employee_id, effective_date, base_salary_annual, bonus_eligible, notes)
SELECT
  c.employee_id,
  (e.hire_date + INTERVAL '1 year')::date,
  ROUND((c.base_salary_annual * 1.04)::numeric, 2),
  c.bonus_eligible,
  'Annual merit'
FROM hr.compensation_history c
JOIN hr.employees e ON e.employee_id = c.employee_id
WHERE c.effective_date = e.hire_date
  AND e.employment_status = 'active'
  AND random() > 0.35;

INSERT INTO hr.leave_requests (employee_id, request_type, start_date, end_date, hours_requested, status, approved_by_id)
SELECT
  e.employee_id,
  CASE (abs(hashtext(e.employee_number::text)) % 4) WHEN 0 THEN 'pto' WHEN 1 THEN 'sick' WHEN 2 THEN 'parental' ELSE 'other' END,
  DATE '2024-06-01' + (n * 3),
  DATE '2024-06-03' + (n * 3),
  16,
  CASE WHEN random() > 0.2 THEN 'approved' ELSE 'pending' END,
  m.employee_id
FROM hr.employees e
LEFT JOIN hr.employees m ON m.employee_id = e.manager_id
CROSS JOIN generate_series(1, 2) AS n
WHERE e.employment_status = 'active'
  AND e.employee_id % 3 = 0;

INSERT INTO hr.performance_reviews (employee_id, reviewer_id, period_start, period_end, overall_rating, goals_met_pct, promotion_ready, summary)
SELECT
  e.employee_id,
  COALESCE(e.manager_id, e.employee_id),
  DATE '2024-01-01',
  DATE '2024-06-30',
  2.5 + random() * 2.5,
  70 + random() * 28,
  random() > 0.85,
  'Solid contributions; continue growth in cross-functional collaboration.'
FROM hr.employees e
WHERE e.employment_status IN ('active', 'leave');

INSERT INTO hr.training_completions (employee_id, course_code, course_name, completed_on, score_pct, is_mandatory)
SELECT
  e.employee_id,
  c.code,
  c.name,
  DATE '2024-01-15' + (random() * 200)::INT,
  80 + random() * 20,
  c.mandatory
FROM hr.employees e
CROSS JOIN (
  VALUES
    ('CODE-ETHICS', 'Code of Conduct & Ethics', TRUE),
    ('SEC-AWARE', 'Security Awareness 101', TRUE),
    ('DEI-101', 'Inclusive Workplace Foundations', TRUE),
    ('SQL-INTRO', 'SQL for Analysts', FALSE),
    ('LEAD-101', 'People Leadership Essentials', FALSE)
) AS c(code, name, mandatory)
WHERE e.employment_status = 'active'
  AND random() > 0.25;

COMMIT;

-- Quick sanity checks (optional — uncomment to run)
-- SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'hr' ORDER BY tablename;
-- SELECT COUNT(*) AS employees FROM hr.employees;
-- SELECT d.name, COUNT(*) FROM hr.employees e JOIN hr.departments d USING (department_id) GROUP BY d.name;
