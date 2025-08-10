# LineSentry - Real-Time Machine Analytics Platform

## Table of Contents
- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Solution](#solution)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Security](#security)
- [Future Improvements](#future-improvements)
- [Installation & Setup](#installation--setup)
- [Usage](#usage)

## 1. Overview <a name="overview"></a>
LineSentry is a real-time analytics platform for industrial machinery, designed to monitor OEE (Overall Equipment Effectiveness), MTTR (Mean Time To Repair), and MTBF (Mean Time Between Failures). It integrates with PLCs via Raspberry Pi to capture power/unit-cycle signals, replacing legacy SAP-based systems and proprietary solutions like ProManage. The platform offers live dashboards, automated alerts, and customizable reporting, empowering Dawlance with full control over machine analytics.

## 2. Problem Statement <a name="problem-statement"></a>
- Legacy SAP systems provided only historical MTTR/MTBF data, lacking real-time insights.
- Solutions like ProManage were inflexible (limited hardware/machine support), expensive (€200K), and vendor-dependent.
- Paper-based layouts and manual data entry caused operational delays.
- No unified view of factory-wide/department-level OEE, MTTR, or MTBF.

## 3. Solution <a name="solution"></a>
LineSentry leverages PLCs + Raspberry Pi to ingest real-time signals from generic machines. It processes data to compute:
- **Production Metrics:** Units produced, defects, performance, availability, quality.
- **Analytics:** Real-time OEE, MTTR, MTBF, downtime classification.
- **Automation:** Breakdown emails to maintenance teams, shift/mold tracking.

**Advantages:**
- ✅ Cost-effective (open hardware, no vendor lock-in).
- ✅ Flexible (supports any machine via PLC signal mapping).
- ✅ User-friendly (drag-and-drop layouts, intuitive UI).

## 4. Key Features <a name="key-features"></a>

### Admin Capabilities
- **User/Role Management:** CRUD operations for users, role assignment (Admin/Operator), least-privilege principle.
- **Machine/Department Setup:**
  - Map machines to departments with interactive drag-and-drop layouts.
  - Configure PLCs (IP, rack, slot), signal types (power/unit-cycle), and pin mappings.
- **Production Configuration:**
  - Define molds with ideal cycle times (for performance calculation).
  - Set shift timings, assign operators/molds per shift (batch/hourly).
  - Configure email alerts (SMTP credentials, recipient lists).
- **Thresholds & Reporting:**
  - Customize OEE/MTTR/MTBF thresholds (Excellent/Good/Fair/Bad).
  - Generate/download reports by department, machine, or timeframe.

### Operator Capabilities
- Real-time machine status (Running/Inactive/Breakdown).
- Log defects, classify stoppages, and link SAP notification IDs during breakdowns.
- View live production timelines (operator/mold history, defects).

### Dashboard & Analytics
- **Factory Overview:**
  - Cards: Departments, active machines, factory OEE, unclassified stoppages.
- **Department View:**
  - Machine layouts with OEE, units produced, and statuses.
  - Add/remove machines dynamically.
- **Machine Analytics:**
  - Weekly/monthly/custom OEE, MTTR, MTBF trends.
  - Production timeline: Live operator/mold/defect tracking with stoppage classification.

### Reports
- Customizable PDF/Excel reports emailed to stakeholders.

## 5. System Architecture <a name="system-architecture"></a>

### Design Patterns
- Singleton: Database connection pooling.
- MVC: Separation of concerns (Model-View-Controller).
- Adapter: Unified interfaces for PLC signal ingestion.
- Observer: Real-time notifications for CRUD operations.
- Decorator: Secured API route middleware.

### Tech Stack
| Layer | Technologies |
|-------|-------------|
| Frontend | React, TailwindCSS, Material UI, Lucide-react |
| Backend | Node.js, Express.js, TypeScript |
| Database | MongoDB (Repository pattern) |
| PLC Integration | Python/Rust daemons (signal ingestion) |

### Data Flow
- Diagram
- Code

## 6. Security <a name="security"></a>
- **Authentication**: JWT-based access control with CAPTCHA protection against brute-force attacks.
- **API Protection**: 
  - Axios HTTP client with CSRF tokens and XSS prevention
  - Rate limiting (5 login attempts per 15 minutes, 100 general requests per 15 minutes)
  - Helmet.js for security headers
  - Google reCAPTCHA v2 integration
- Credentials: .env file (excluded from Git).
- RBAC: Operators restricted to data entry; Admins own configurations.
- **Request Security**: All API calls use axios with proper error handling and timeout configuration.

## 7. Future Improvements <a name="future-improvements"></a>
- Biometric Security: Card/facial recognition for login.
- Computer Vision: Automated defect detection.
- Energy Monitoring: Track machine power consumption.
- Layout Export: Download department machine layouts as PDF.

## 8. Installation & Setup <a name="installation--setup"></a>

### Prerequisites
- Node.js v18+, MongoDB Atlas, Python 3.10/Rust.
- Raspberry Pi 4+ with PLC connectivity.

### Steps
1. Clone the repo:
   ```bash
   git clone https://github.com/dawlance/linesentry.git
   ```
2. Backend:
   ```bash
   sudo systemctl start mongodb
   cd server && npm install
   cp .env.example .env  # Set DB/JWT configs
   node index.js
   ```
3. Frontend:
   ```bash
   npm install
   npm run dev
   ```
4. PLC Daemon:
   ```bash
   cd python-daemon
   python signal_daemon.py
   ```
   or
   ```bash
   cd rust-daemon
   cargo run
   ```
   
## 9. Usage <a name="usage"></a>

- **Admin Login:**
  - Configure departments, machines, PLCs, and shifts.
  - Set OEE/MTTR thresholds and email alerts.

- **Operator Login:**
  - View assigned machines; log defects/stoppages.
  - Classify breakdowns with SAP notification IDs.

- **Dashboard:**
  - Monitor factory/department OEE at a glance.
  - Click machines to analyze trends or update production logs.
