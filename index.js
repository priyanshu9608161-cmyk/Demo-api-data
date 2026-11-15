const http = require("http");

// 5,000 deterministic DEMO students. No real student information is used.
const firstNames = [
  "Aarav","Vivaan","Aditya","Priyanshu","Rohan","Rahul","Ananya","Aditi","Sneha","Pooja",
  "Neha","Kavya","Aman","Vikas","Saurabh","Riya","Simran","Kunal","Deepak","Nisha",
  "Ishita","Arjun","Meera","Kabir","Diya","Krishna","Anushka","Manish","Tanya","Yash",
  "Sakshi","Aryan","Shivam","Payal","Harsh","Isha","Mohan","Ritika","Abhishek","Nandini"
];
const surnames = [
  "Kumar","Singh","Sharma","Yadav","Gupta","Verma","Mandal","Jha","Das","Choudhary",
  "Prasad","Mishra","Roy","Thakur","Sinha","Pandey","Rai","Patel","Kushwaha","Sah"
];
const fathers = ["Rajesh Kumar","Suresh Singh","Mahesh Yadav","Ramesh Sharma","Dinesh Gupta","Mohan Mandal","Anil Das","Sunil Jha","Ajay Verma","Vijay Choudhary"];
const mothers = ["Sunita Devi","Rekha Devi","Poonam Devi","Sita Devi","Meena Devi","Anita Devi","Kiran Devi","Asha Devi","Rani Devi","Geeta Devi"];
const schools = ["Government High School","Adarsh Public School","Bihar Model School","Gyan Niketan School","National Public School"];
const districts = ["Patna","Khagaria","Begusarai","Bhagalpur","Munger","Samastipur","Purnia","Nalanda","Gaya","Muzaffarpur","Darbhanga","Bhojpur","Saran","Vaishali","Sitamarhi","Saharsa"];

const students = Array.from({ length: 5000 }, (_, i) => {
  const n = i + 1;
  return {
    id: `STU${String(n).padStart(4, "0")}`,
    name: `${firstNames[i % firstNames.length]} ${surnames[Math.floor(i / firstNames.length) % surnames.length]} ${String(n).padStart(4, "0")}`,
    class: String(6 + (i % 7)),
    rollNumber: String(((i % 100) + 1)).padStart(3, "0"),
    fatherName: fathers[i % fathers.length],
    motherName: mothers[(i * 3) % mothers.length],
    mobile: `DEMO-NUMBER-${String(n).padStart(4, "0")}`,
    school: schools[i % schools.length],
    district: districts[i % districts.length],
    state: "Bihar"
  };
});

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { success: true });
  if (req.method !== "GET") {
    return sendJson(res, 405, { success: false, message: "Only GET requests are supported" });
  }

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/api") {
    return sendJson(res, 200, {
      success: true,
      message: "Demo Student API is running",
      totalStudents: students.length,
      endpoints: [
        "GET /students",
        "GET /students?page=1&limit=100",
        "GET /students/STU0001",
        "GET /stats"
      ]
    });
  }

  if (path === "/stats") {
    const byClass = {};
    const byDistrict = {};
    for (const student of students) {
      byClass[student.class] = (byClass[student.class] || 0) + 1;
      byDistrict[student.district] = (byDistrict[student.district] || 0) + 1;
    }
    return sendJson(res, 200, {
      success: true,
      totalStudents: students.length,
      byClass,
      byDistrict
    });
  }

  if (path === "/students" || path === "/students/") {
    let result = students;
    const classFilter = url.searchParams.get("class");
    const districtFilter = url.searchParams.get("district");
    const search = (url.searchParams.get("search") || "").toLowerCase().trim();

    if (classFilter) result = result.filter(s => s.class === classFilter);
    if (districtFilter) result = result.filter(s => s.district.toLowerCase() === districtFilter.toLowerCase());
    if (search) {
      result = result.filter(s =>
        s.name.toLowerCase().includes(search) ||
        s.id.toLowerCase().includes(search) ||
        s.school.toLowerCase().includes(search)
      );
    }

    const total = result.length;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
    const start = (page - 1) * limit;
    return sendJson(res, 200, {
      success: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: result.slice(start, start + limit)
    });
  }

  const match = path.match(/^\/students\/(STU\d{4})$/i);
  if (match) {
    const student = students.find(s => s.id.toLowerCase() === match[1].toLowerCase());
    if (!student) return sendJson(res, 404, { success: false, message: "Student not found" });
    return sendJson(res, 200, { success: true, data: student });
  }

  return sendJson(res, 404, { success: false, message: "Endpoint not found. Visit / for API information." });
}

// Vercel Node function export
module.exports = handler;

// Also allow local testing with: npm start
if (require.main === module) {
  const port = process.env.PORT || 3000;
  http.createServer(handler).listen(port, () => {
    console.log(`Demo Student API running at http://localhost:${port}`);
  });
}
