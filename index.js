const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const express = require("express");
// const jwt = require('jsonwebtoken');
const jwt = require("jsonwebtoken");
// ei stripe e env kaj kortese na
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;

// middleware
const app = express();
const cors = require("cors");
app.use(cors());
app.use(express.json());
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.26rep.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// verify token

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "UnAuthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    await client.connect();
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");
    const userCollection = client.db("doctors_portal").collection("users");
    const doctorCollection = client.db("doctors_portal").collection("doctors");
    const paymentCollection = client.db("doctors_portal").collection("payments");
    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "forbidden" });
      }
    };
    
    //get  user
    app.get("/user", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });
    // get admin data
    app.get("/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send(isAdmin);
    });
    // admin
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updatedDoc = {
        $set: { role: "admin" },
      };

      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // update user

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result, token });
    });
    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });


    // stripe

    app.post("/create_payment_intent",verifyJWT, async (req, res) => {
      const service = req.body;
      const price = service.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types:["card"],
      });
      res.send({clientSecret: paymentIntent.client_secret });
    });


    // WARNING:ITS NOT THE PROPER WAY
    app.get("/available", async (req, res) => {
      const date = req.query.date;
      // get all services
      const services = await serviceCollection.find().toArray();
      // res.send(services)

      // get the booking of the day
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();
      // res.send(bookings);
      services.forEach((service) => {
        // ei line ekhono clear hoi nai
        const serviceBookings = bookings.filter(
          (booking) => booking.treatment === service.name
        );
        // const booked=serviceBookings.map(s=>s.slot);
        const bookedSlots = serviceBookings.map((book) => book.slot);
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        service.slots = available;
      });
      res.send(services);
    });

    // specific users bookings for my appointment

    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (decodedEmail === patient) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        return res.send(bookings);
      } else {
        res.status(403).send({ message: "forbidden access" });
      }
    });
    app.get("/booking/:id", async (req, res) => {
      const id = req.params.id;
      const query = ObjectId(id);
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
     
    });
    app.patch("/booking/:id",async(req,res)=>{
      const id =req.params.id;
      const filter={_id:ObjectId(id)}
      const payment=req.body
     const updatedDoc={
      $set:{
        paid:true,
        transactionId:payment.transactionId,
      }
     }

     const updatedBooking= await bookingCollection.updateOne(filter,updatedDoc);
     const result= await paymentCollection.insertOne(payment);
     console.log('done');
     res.send(updatedDoc)
     
    })

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exist = await bookingCollection.findOne(query);
      if (exist) {
        return res.send({ success: false, booking: exist });
      } else {
        const result = await bookingCollection.insertOne(booking);
        res.send({ success: true, booking: result });
      }
    });
    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });
    app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = await doctorCollection.find().toArray();
      res.send(doctor);
    });
    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log("listening to port", port);
});
