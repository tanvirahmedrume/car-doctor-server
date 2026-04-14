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
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// logger middleware
const logger = (req, res, next) => {
  console.log("called:", req.method, req.hostname, req.originalUrl);
  next();
};

// verify JWT
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    req.user = decoded; // 🔥 important
    next();
  });
};

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.send("Doctor server is running...");
});

// MongoDB
const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-cijrguo-shard-00-00.ot5pbdy.mongodb.net:27017,ac-cijrguo-shard-00-01.ot5pbdy.mongodb.net:27017,ac-cijrguo-shard-00-02.ot5pbdy.mongodb.net:27017/?ssl=true&replicaSet=atlas-kf3nj0-shard-0&authSource=admin&appName=ClusterCarDoctor`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("✅ MongoDB Connected");

    const serviceCollection = client
      .db("carDoctor")
      .collection("services");
    const bookingCollection = client
      .db("carDoctor")
      .collection("booking");

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
          { expiresIn: "1h" }
        );

        res
          .cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite:
              process.env.NODE_ENV === "production" ? "none" : "lax",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ================= SERVICES =================
    app.get("/services", async (req, res) => {
      try {
        const result = await serviceCollection.find().toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get("/services/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID" });
        }

        const result = await serviceCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).send({ message: "Not found" });
        }

        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ================= BOOKINGS =================

    // GET booking (secured)
    app.get("/booking", logger, verifyToken, async (req, res) => {
      try {
        const email = req.query.email;

        // 🔥 prevent data leak
        if (email !== req.user.email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }

        const query = {
          "customerInfo.email": email,
        };

        const result = await bookingCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // CREATE booking
    app.post("/booking", async (req, res) => {
      try {
        const booking = req.body;

        if (!booking) {
          return res.status(400).send({ message: "Invalid data" });
        }

        const result = await bookingCollection.insertOne(booking);
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // UPDATE booking (secured)
    app.patch("/booking/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updated = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID" });
        }

        const result = await bookingCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: updated.status,
            },
          }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // DELETE booking (secured)
    app.delete("/booking/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID" });
        }

        const result = await bookingCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ================= PING =================
    await client.db("admin").command({ ping: 1 });
    console.log("🚀 MongoDB Ping Success");
  } catch (err) {
    console.error("❌ DB Connection Failed:", err);
  }
}

run().catch(console.dir);

// ================= SERVER =================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});