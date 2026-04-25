const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { z } = require("zod");
const ExcelJS = require("exceljs");
require("dotenv").config();

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:Qwaszx%402188@localhost:5432/unmute_db",
});

app.get("/api/init-db", async (req, res) => {
  try {
    const query = `
      DROP TABLE IF EXISTS audit_logs;
      DROP TABLE IF EXISTS bookings;
      DROP TABLE IF EXISTS schools;

      CREATE TABLE schools (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          logo_url TEXT,
          created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE bookings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          booking_date DATE UNIQUE NOT NULL,
          school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
          contact_name VARCHAR(255) NOT NULL,
          phone_number VARCHAR(20) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          admin_id VARCHAR(255) NOT NULL,
          action VARCHAR(50) NOT NULL,
          target_id UUID NOT NULL,
          old_values JSONB,
          new_values JSONB,
          timestamp TIMESTAMP DEFAULT NOW()
      );
    `;
    await pool.query(query);
    res.json({ message: "Database reinitialized successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB_ERROR", message: err.message });
  }
});

app.get("/api/migrate", async (req, res) => {
  try {
    const query = `
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Menunggu';
      
      CREATE TABLE IF NOT EXISTS delegates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
          nisn VARCHAR(50) NOT NULL,
          name VARCHAR(255) NOT NULL,
          topic VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
      );
    `;
    await pool.query(query);
    res.json({ message: "Migration completed successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB_ERROR", message: err.message });
  }
});

const HOLIDAYS = [
  "2026-05-01",
  "2026-05-04",
  "2026-05-14",
  "2026-05-15",
  "2026-05-27",
  "2026-05-28",
  "2026-05-29",
  "2026-06-01",
  "2026-06-16",
  "2026-07-27",
  "2026-07-31",
];

const BOOTCAMP_DATES = ["2026-07-28", "2026-07-29", "2026-07-30"];

const ALLOWED_START = "2026-05-05";
const ALLOWED_END = "2026-07-31";

const bookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  school_id: z.string().uuid(),
  contact_name: z.string().min(3),
  phone_number: z.string().min(10).max(15),
});

function validateBookingDate(dateStr) {
  const dateObj = new Date(`${dateStr}T00:00:00`);
  const day = dateObj.getDay();

  if (dateStr < ALLOWED_START || dateStr > ALLOWED_END) {
    return {
      valid: false,
      message: "Tanggal hanya boleh antara 5 Mei 2026 sampai 31 Juli 2026.",
    };
  }

  if (day === 0 || day === 6) {
    return { valid: false, message: "Hari Sabtu dan Minggu tidak dapat dipilih." };
  }

  if (HOLIDAYS.includes(dateStr)) {
    return { valid: false, message: "Tanggal ini adalah hari libur dan tidak dapat dipilih." };
  }

  if (BOOTCAMP_DATES.includes(dateStr)) {
    return {
      valid: false,
      message: "Tanggal ini dipakai untuk Bootcamp & Grand Final di Universitas Fajar.",
    };
  }

  return { valid: true };
}

function formatIndonesianDate(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

// ================================
// SCHOOLS
// ================================

app.get("/api/schools", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name FROM schools ORDER BY name ASC");
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: "Gagal mengambil data sekolah.",
    });
  }
});

app.post("/api/schools", async (req, res) => {
  try {
    const { name } = req.body;
    const cleanName = name?.trim();

    if (!cleanName) {
      return res.status(400).json({
        error: "INVALID",
        message: "Nama sekolah wajib diisi.",
      });
    }

    const duplicate = await pool.query(
      "SELECT id FROM schools WHERE LOWER(name) = LOWER($1)",
      [cleanName]
    );

    if (duplicate.rowCount > 0) {
      return res.status(409).json({
        error: "DUPLICATE",
        message: "Nama sekolah sudah ada.",
      });
    }

    const result = await pool.query(
      "INSERT INTO schools (name) VALUES ($1) RETURNING id, name",
      [cleanName]
    );

    return res.status(201).json({
      message: "Sekolah berhasil ditambahkan.",
      school: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: "Gagal menambahkan sekolah.",
    });
  }
});

app.put("/api/schools/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const cleanName = req.body.name?.trim();

    if (!cleanName) {
      return res.status(400).json({
        error: "INVALID",
        message: "Nama sekolah wajib diisi.",
      });
    }

    const duplicate = await pool.query(
      "SELECT id FROM schools WHERE LOWER(name) = LOWER($1) AND id <> $2",
      [cleanName, id]
    );

    if (duplicate.rowCount > 0) {
      return res.status(409).json({
        error: "DUPLICATE",
        message: "Nama sekolah sudah ada.",
      });
    }

    const result = await pool.query(
      "UPDATE schools SET name = $1 WHERE id = $2 RETURNING id, name",
      [cleanName, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "Sekolah tidak ditemukan.",
      });
    }

    return res.json({
      message: "Sekolah berhasil diperbarui.",
      school: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: "Gagal memperbarui sekolah.",
    });
  }
});

app.delete("/api/schools/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const school = await pool.query("SELECT id FROM schools WHERE id = $1", [id]);

    if (school.rowCount === 0) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "Sekolah tidak ditemukan.",
      });
    }

    const bookings = await pool.query(
      "SELECT id FROM bookings WHERE school_id = $1 LIMIT 1",
      [id]
    );

    if (bookings.rowCount > 0) {
      return res.status(409).json({
        error: "HAS_BOOKING",
        message: "Sekolah ini sudah memiliki booking. Hapus booking terlebih dahulu.",
      });
    }

    await pool.query("DELETE FROM schools WHERE id = $1", [id]);

    return res.json({ message: "Sekolah berhasil dihapus." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: "Gagal menghapus sekolah.",
    });
  }
});

// ================================
// BOOKINGS
// ================================

app.get("/api/bookings", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.id,
        b.booking_date AS date,
        s.name AS school_name,
        b.contact_name AS pic,
        b.phone_number AS phone,
        b.status
      FROM bookings b
      JOIN schools s ON b.school_id = s.id
      ORDER BY b.booking_date ASC
    `);

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: "Gagal mengambil data booking.",
      details: err.message,
      stack: err.stack
    });
  }
});

app.post("/api/bookings", async (req, res) => {
  try {
    const data = bookingSchema.parse(req.body);

    const validation = validateBookingDate(data.date);
    if (!validation.valid) {
      return res.status(400).json({
        error: "INVALID_DATE",
        message: validation.message,
      });
    }

    const existingSchool = await pool.query(
      "SELECT id FROM bookings WHERE school_id = $1",
      [data.school_id]
    );

    if (existingSchool.rowCount > 0) {
      return res.status(409).json({
        error: "CONFLICT",
        message: "Sekolah ini sudah pernah booking dan tidak bisa booking lagi.",
      });
    }

    const existingDate = await pool.query(
      "SELECT id FROM bookings WHERE booking_date = $1",
      [data.date]
    );

    if (existingDate.rowCount > 0) {
      return res.status(409).json({
        error: "CONFLICT",
        message: "Tanggal ini sudah dipilih oleh sekolah lain.",
      });
    }

    const existingPhone = await pool.query(
      "SELECT id FROM bookings WHERE phone_number = $1",
      [data.phone_number]
    );

    if (existingPhone.rowCount > 0) {
      return res.status(409).json({
        error: "CONFLICT",
        message: "Nomor WhatsApp ini sudah digunakan pada booking lain.",
      });
    }

    const result = await pool.query(
      `INSERT INTO bookings (booking_date, school_id, contact_name, phone_number)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.date, data.school_id, data.contact_name, data.phone_number]
    );

    return res.status(201).json({
      message: "Booking berhasil disimpan.",
      booking: result.rows[0],
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Data booking tidak valid.",
        details: err.errors,
      });
    }

    console.error(err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: "Gagal menyimpan booking.",
    });
  }
});

app.put("/api/bookings/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const data = bookingSchema.parse(req.body);

    const validation = validateBookingDate(data.date);
    if (!validation.valid) {
      return res.status(400).json({
        error: "INVALID_DATE",
        message: validation.message,
      });
    }

    const current = await pool.query("SELECT id FROM bookings WHERE id = $1", [id]);

    if (current.rowCount === 0) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "Booking tidak ditemukan.",
      });
    }

    const existingSchool = await pool.query(
      "SELECT id FROM bookings WHERE school_id = $1 AND id <> $2",
      [data.school_id, id]
    );

    if (existingSchool.rowCount > 0) {
      return res.status(409).json({
        error: "CONFLICT",
        message: "Sekolah ini sudah memiliki booking lain.",
      });
    }

    const existingDate = await pool.query(
      "SELECT id FROM bookings WHERE booking_date = $1 AND id <> $2",
      [data.date, id]
    );

    if (existingDate.rowCount > 0) {
      return res.status(409).json({
        error: "CONFLICT",
        message: "Tanggal ini sudah dipilih oleh sekolah lain.",
      });
    }

    const existingPhone = await pool.query(
      "SELECT id FROM bookings WHERE phone_number = $1 AND id <> $2",
      [data.phone_number, id]
    );

    if (existingPhone.rowCount > 0) {
      return res.status(409).json({
        error: "CONFLICT",
        message: "Nomor WhatsApp ini sudah digunakan pada booking lain.",
      });
    }

    const result = await pool.query(
      `UPDATE bookings
       SET booking_date = $1,
           school_id = $2,
           contact_name = $3,
           phone_number = $4
       WHERE id = $5
       RETURNING *`,
      [data.date, data.school_id, data.contact_name, data.phone_number, id]
    );

    return res.json({
      message: "Booking berhasil diperbarui.",
      booking: result.rows[0],
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Data booking tidak valid.",
        details: err.errors,
      });
    }

    console.error(err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: "Gagal memperbarui booking.",
    });
  }
});

app.delete("/api/bookings/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const current = await pool.query("SELECT id FROM bookings WHERE id = $1", [id]);

    if (current.rowCount === 0) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "Booking tidak ditemukan.",
      });
    }

    await pool.query("DELETE FROM bookings WHERE id = $1", [id]);

    return res.json({ message: "Booking berhasil dihapus." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: "Gagal menghapus booking.",
    });
  }
});

app.put("/api/bookings/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const current = await pool.query("SELECT id FROM bookings WHERE id = $1", [id]);
    if (current.rowCount === 0) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Booking tidak ditemukan." });
    }

    const result = await pool.query(
      "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    return res.json({ message: "Status berhasil diperbarui.", booking: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Gagal memperbarui status." });
  }
});

// ================================
// DELEGATES
// ================================

app.get("/api/delegates/school/:school_id", async (req, res) => {
  try {
    const { school_id } = req.params;
    const result = await pool.query(
      "SELECT * FROM delegates WHERE school_id = $1 ORDER BY created_at ASC",
      [school_id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Gagal mengambil data siswa." });
  }
});

app.get("/api/delegates", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.id,
        d.nisn,
        d.name,
        d.topic,
        s.name AS school_name
      FROM delegates d
      JOIN schools s ON d.school_id = s.id
      ORDER BY s.name ASC, d.name ASC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Gagal mengambil semua data siswa." });
  }
});

app.post("/api/delegates", async (req, res) => {
  try {
    const { school_id, nisn, name, topic } = req.body;
    
    // Check max 10
    const countRes = await pool.query("SELECT COUNT(*) FROM delegates WHERE school_id = $1", [school_id]);
    if (parseInt(countRes.rows[0].count) >= 10) {
      return res.status(400).json({ error: "LIMIT_REACHED", message: "Maksimal 10 siswa per sekolah." });
    }

    const duplicate = await pool.query("SELECT id FROM delegates WHERE nisn = $1", [nisn]);
    if (duplicate.rowCount > 0) {
      return res.status(409).json({ error: "DUPLICATE", message: "NISN ini sudah terdaftar." });
    }

    const result = await pool.query(
      "INSERT INTO delegates (school_id, nisn, name, topic) VALUES ($1, $2, $3, $4) RETURNING *",
      [school_id, nisn, name, topic]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Gagal menambahkan siswa." });
  }
});

app.put("/api/delegates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nisn, name, topic } = req.body;

    const current = await pool.query("SELECT school_id FROM delegates WHERE id = $1", [id]);
    if (current.rowCount === 0) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Siswa tidak ditemukan." });
    }

    const duplicate = await pool.query(
      "SELECT id FROM delegates WHERE nisn = $1 AND id <> $2",
      [nisn, id]
    );
    if (duplicate.rowCount > 0) {
      return res.status(409).json({ error: "DUPLICATE", message: "NISN ini sudah terdaftar oleh siswa lain." });
    }

    const result = await pool.query(
      "UPDATE delegates SET nisn = $1, name = $2, topic = $3 WHERE id = $4 RETURNING *",
      [nisn, name, topic, id]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Gagal memperbarui siswa." });
  }
});

app.delete("/api/delegates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM delegates WHERE id = $1 RETURNING id", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Siswa tidak ditemukan." });
    }
    return res.json({ message: "Siswa berhasil dihapus." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Gagal menghapus siswa." });
  }
});

app.delete("/api/delegates/school/:school_id", async (req, res) => {
  try {
    const { school_id } = req.params;
    await pool.query("DELETE FROM delegates WHERE school_id = $1", [school_id]);
    return res.json({ message: "Semua delegasi sekolah berhasil dihapus." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Gagal menghapus delegasi sekolah." });
  }
});

// ================================
// EXPORT EXCEL
// ================================

app.get("/api/export/bookings", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.booking_date AS date,
        s.name AS school_name,
        b.contact_name AS pic,
        b.phone_number AS phone,
        b.status
      FROM bookings b
      JOIN schools s ON b.school_id = s.id
      ORDER BY b.booking_date ASC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Daftar Booking");

    worksheet.mergeCells("A1:F1");
    worksheet.getCell("A1").value = "DAFTAR BOOKING KEGIATAN";
    worksheet.getCell("A1").font = { bold: true, size: 16 };
    worksheet.getCell("A1").alignment = { horizontal: "center" };

    worksheet.columns = [
      { header: "No", key: "no", width: 8 },
      { header: "Nama Sekolah", key: "school_name", width: 35 },
      { header: "PIC", key: "pic", width: 25 },
      { header: "No HP", key: "phone", width: 20 },
      { header: "Tanggal Booking", key: "date", width: 30 },
      { header: "Status", key: "status", width: 25 },
    ];

    worksheet.spliceRows(2, 0, ["No", "Nama Sekolah", "PIC", "No HP", "Tanggal Booking", "Status"]);

    result.rows.forEach((row, index) => {
      worksheet.addRow({
        no: index + 1,
        school_name: row.school_name,
        pic: row.pic,
        phone: row.phone,
        date: formatIndonesianDate(row.date),
        status: row.status || "Menunggu",
      });
    });

    worksheet.getRow(2).font = { bold: true };
    worksheet.getRow(2).alignment = { horizontal: "center" };

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.alignment = { vertical: "middle" };
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=daftar-booking-kegiatan.xlsx"
    );
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Pragma", "no-cache");

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "SERVER_ERROR",
        message: "Gagal export data booking.",
      });
    }
  }
});

app.get("/api/export/delegates", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.nisn,
        d.name AS student_name,
        s.name AS school_name,
        d.topic
      FROM delegates d
      JOIN schools s ON d.school_id = s.id
      ORDER BY s.name ASC, d.name ASC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Perwakilan Sekolah");

    worksheet.mergeCells("A1:E1");
    worksheet.getCell("A1").value = "DAFTAR PERWAKILAN SEKOLAH (DELEGASI)";
    worksheet.getCell("A1").font = { bold: true, size: 16 };
    worksheet.getCell("A1").alignment = { horizontal: "center" };

    worksheet.columns = [
      { header: "No", key: "no", width: 8 },
      { header: "NISN", key: "nisn", width: 20 },
      { header: "Nama Siswa", key: "student_name", width: 35 },
      { header: "Asal Sekolah", key: "school_name", width: 35 },
      { header: "Topik Materi", key: "topic", width: 30 },
    ];

    worksheet.spliceRows(2, 0, ["No", "NISN", "Nama Siswa", "Asal Sekolah", "Topik Materi"]);

    result.rows.forEach((row, index) => {
      worksheet.addRow({
        no: index + 1,
        nisn: row.nisn,
        student_name: row.student_name,
        school_name: row.school_name,
        topic: row.topic,
      });
    });

    worksheet.getRow(2).font = { bold: true };
    worksheet.getRow(2).alignment = { horizontal: "center" };

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.alignment = { vertical: "middle" };
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=daftar-perwakilan-sekolah.xlsx"
    );
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Pragma", "no-cache");

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "SERVER_ERROR",
        message: "Gagal export data delegasi.",
      });
    }
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Server on ${PORT}`));