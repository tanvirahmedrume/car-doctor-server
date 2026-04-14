const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// ================= MIDDLEWARE =================
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://cardoctor-a1530.web.app",
      "https://cardoctor-a1530.firebaseapp.com"
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Accept'],
  })
);
app.use(express.json());
app.use(cookieParser());

// Logger middleware
const logger = (req, res, next) => {
  console.log(`${req.method} ${req.originalUrl} - ${new Date().toISOString()}`);
  next();
};

// Verify JWT middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;

  console.log("Checking token...");
  console.log("Cookies received:", req.cookies);

  if (!token) {
    console.log("No token found in cookies");
    return res.status(401).send({ message: "Unauthorized - No token provided" });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log("Token verification failed:", err.message);
      return res.status(401).send({ message: "Unauthorized - Invalid token" });
    }

    console.log("Token verified for email:", decoded.email);
    req.user = decoded;
    next();
  });
};

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.send("Car Doctor server is running...");
});

// ================= MONGODB CONNECTION =================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@clusterCardoctor.ot5pbdy.mongodb.net/?retryWrites=true&w=majority&appName=ClusterCarDoctor`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect to MongoDB
    await client.connect();
    console.log("✅ MongoDB Connected Successfully");

    const serviceCollection = client.db("carDoctor").collection("services");
    const bookingCollection = client.db("carDoctor").collection("booking");

    // ================= JWT API =================
    app.post("/jwt", logger, async (req, res) => {
      try {
        const user = req.body;

        if (!user?.email) {
          return res.status(400).send({ message: "Email required" });
        }

        const token = jwt.sign(
          { email: user.email },
          process.env.ACCESS_TOKEN_SECRET,
          { expiresIn: "7d" }
        );

        // Set cookie with proper settings for production
        res.cookie("token", token, {
          httpOnly: true,
          secure: true, // Must be true for HTTPS
          sameSite: "none", // Required for cross-origin requests
          domain: ".up.railway.app", // Allow cookie on all subdomains
          path: "/",
          maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        console.log("JWT token created for:", user.email);
        res.send({ success: true, message: "Token created successfully" });
      } catch (err) {
        console.error("JWT Error:", err);
        res.status(500).send({ error: err.message });
      }
    });

    // ================= LOGOUT API =================
    app.post("/logout", async (req, res) => {
      res.clearCookie("token", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        domain: ".up.railway.app",
        path: "/"
      });
      res.send({ success: true, message: "Logged out successfully" });
    });

    // ================= SERVICES API =================
    app.get("/services", async (req, res) => {
      try {
        const result = await serviceCollection.find().toArray();
        res.send(result);
      } catch (err) {
        console.error("Error fetching services:", err);
        res.status(500).send({ error: err.message });
      }
    });

    app.get("/services/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID format" });
        }

        const result = await serviceCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).send({ message: "Service not found" });
        }

        res.send(result);
      } catch (err) {
        console.error("Error fetching service:", err);
        res.status(500).send({ error: err.message });
      }
    });

    // ================= BOOKINGS API =================

    // GET bookings (secured)
    app.get("/booking", logger, verifyToken, async (req, res) => {
      try {
        const email = req.query.email;

        console.log("GET /booking - Email:", email);
        console.log("User from token:", req.user.email);

        // Security check - prevent data leak
        if (email !== req.user.email) {
          console.log("Forbidden access - Email mismatch");
          return res.status(403).send({ message: "Forbidden Access - Email mismatch" });
        }

        const query = { "customerInfo.email": email };
        const result = await bookingCollection.find(query).toArray();
        
        console.log(`Found ${result.length} bookings for ${email}`);
        res.send(result);
      } catch (err) {
        console.error("Error fetching bookings:", err);
        res.status(500).send({ error: err.message });
      }
    });

    // CREATE booking (no auth required)
    app.post("/booking", async (req, res) => {
      try {
        const booking = req.body;

        if (!booking || !booking.customerInfo?.email) {
          return res.status(400).send({ message: "Invalid booking data" });
        }

        // Add timestamps
        booking.createdAt = new Date();
        booking.status = booking.status || "pending";

        const result = await bookingCollection.insertOne(booking);
        console.log("Booking created for:", booking.customerInfo.email);
        res.send(result);
      } catch (err) {
        console.error("Error creating booking:", err);
        res.status(500).send({ error: err.message });
      }
    });

    // UPDATE booking (secured)
    app.patch("/booking/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updated = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID format" });
        }

        // Verify the booking belongs to the user
        const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
        
        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        if (booking.customerInfo.email !== req.user.email) {
          return res.status(403).send({ message: "Forbidden - Not your booking" });
        }

        const result = await bookingCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: updated.status,
              updatedAt: new Date()
            },
          }
        );

        console.log("Booking updated:", id, "Status:", updated.status);
        res.send(result);
      } catch (err) {
        console.error("Error updating booking:", err);
        res.status(500).send({ error: err.message });
      }
    });

    // DELETE booking (secured)
    app.delete("/booking/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID format" });
        }

        // Verify the booking belongs to the user
        const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
        
        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        if (booking.customerInfo.email !== req.user.email) {
          return res.status(403).send({ message: "Forbidden - Not your booking" });
        }

        const result = await bookingCollection.deleteOne({
          _id: new ObjectId(id),
        });

        console.log("Booking deleted:", id);
        res.send(result);
      } catch (err) {
        console.error("Error deleting booking:", err);
        res.status(500).send({ error: err.message });
      }
    });

    // ================= OPTIONS PRE-FLIGHT =================
    app.options('*', cors());

    // Test MongoDB connection
    await client.db("admin").command({ ping: 1 });
    console.log("🚀 MongoDB Ping Success");

  } catch (err) {
    console.error("❌ Database Connection Failed:", err);
  }
}

// Start the server
run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});