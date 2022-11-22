const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require('dotenv').config();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_KEY);
const app = express()
const port = process.env.PORT || 5000

//midleware
app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
    res.send('Doctors portal server is running...')
})

app.listen(port, () => console.log(`Doctors portal server: ${port}`))


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.wpflsxi.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJwt (req, res, next) {
    const authorization = req.headers.authorization;
    if(!authorization) {
        return res.status(401).send('unauthorize access')
    }
    const accessToken = authorization.split(' ')[1]
    jwt.verify(accessToken, process.env.ACCESS_TOKEN, function(err, decoded) {
        if(err) {
            return res.status(403).send({message: 'forbiden access'})
        }
        req.decoded = decoded
        next()
    })
}

async function run() {
    try{
        const appointmentOptionCollection = client.db("DoctorsPortal").collection("appointmentOptions");

        const bookingsCollection = client.db("DoctorsPortal").collection("bookings");
        const usersCollection = client.db("DoctorsPortal").collection("users");
        const doctorsCollection = client.db("DoctorsPortal").collection("doctors");
        const paymentCollection = client.db("DoctorsPortal").collection("payment");

        // Note: verify admin check after vefiryJwt
        const verifyAdmin = async(req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = {email: decodedEmail}
            const user = await usersCollection.findOne(query);
            if(user?.role !== 'admin') {
                return res.status(403).send({message: 'forbidden access'})
            }
            next()
        }

        app.get('/appointmentOptions', async(req, res) => {
            const date = req.query.date;
            const query = {}
            const option = await appointmentOptionCollection.find(query).toArray();
            const bookingQuery = { appointmentDate : date};
            const alreaderyBooked = await bookingsCollection.find(bookingQuery).toArray()
            option.forEach(option => {
                const optionBooked = alreaderyBooked.filter(
                  (book) => book.theetment === option.name
                );
                const bookSlot = optionBooked.map(book => book.slot)
                const remaingSlot = option.slots.filter(slot => !bookSlot.includes(slot))
                option.slots = remaingSlot
            })
            res.send(option)
        })

        app.get("/appointmentSpecialty", async(req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({name: 1}).toArray();
            res.send(result)
        });

        app.get('/bookings/:id', async(req, res) => {
            const id = req.params.id;
            const query = { _id : ObjectId(id)}
            const result = await bookingsCollection.findOne(query);
            res.send(result)
        })

        app.get('/bookings', verifyJwt, async(req, res) =>{
            const email = req.query.email;
            const decodedEmail = req.decoded.email
            if(email !== decodedEmail) {
                return res.status(403).send({message: 'forbiden access'})
            }
            const query = {email : email}
            const data = await bookingsCollection.find(query).toArray();
            res.send(data)
        })

        app.post('/bookings', async(req, res) => {
            const booking = req.body;
            const query = {
              appointmentDate: booking.appointmentDate,
              email: booking.email,
              theetment : booking.theetment,
            };
            const alreaderyBooked = await bookingsCollection.find(query).toArray()
            if(alreaderyBooked.length) {
                const message = `You have already booked: ${booking.appointmentDate}`
                return res.send({acknowledged: false, message})
            }
            const data = await bookingsCollection.insertOne(booking)
            res.send(data)
        })

        app.get('/jwt', async(req, res) => {
            const email = req.query.email;
            const query = {email: email}
            const user = await usersCollection.findOne(query)
            if(user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
                  expiresIn: "1h",
                });
                res.status(403).send({accessToken: token})
            }
            else{
                res.send({ accessToken: "" });
            }
        })

        app.get('/users', async(req, res)=> {
            const query = {}
            const result = await usersCollection.find(query).toArray()
            res.send(result)
        })

        app.post('/users', async(req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user)
            res.send(result)
        })

        app.put("/users/admin/:id", verifyJwt, verifyAdmin, async(req, res) => {
            const id = req.params.id;
            const filter = {_id : ObjectId(id)}
            const options = { upsert: true };
            const updateAdmin = {
                $set: { role: 'admin' }
            }
            const result = await usersCollection.updateOne(filter, updateAdmin, options)
            res.send(result)
        });

        app.get('/users/admin/:email', async(req, res) => {
            const email = req.params.email;
            const query = {email: email}
            const user = await usersCollection.findOne(query);
            res.send({isAdmin: user?.role === 'admin'})
        })

        app.get('/doctors', verifyJwt, verifyAdmin, async(req, res) => {
            const query = {}
            const result = await doctorsCollection.find(query).toArray();
            res.send(result)
        })

        app.post('/doctors', verifyJwt,  async(req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result)
        })

        app.delete('/doctors/:id', verifyJwt, async (req, res) => {
            const id = req.params.id;
            console.log(id)
            const filter = {_id: ObjectId(id)}
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result)
        })

        app.post("/create-payment-intent", async(req, res) => {
            const booking = req.body
            const amount = booking.price * 100
            const paymentIntent = await stripe.paymentIntents.create({
              amount: amount,
              currency: "usd",
              automatic_payment_methods: {
                enabled: true,
              },
            });
            res.send({
              clientSecret: paymentIntent.client_secret,
            });
        });

        app.post('/payments', async(req, res) => {
            const payment = req.body;
            const result = await paymentCollection.insertOne(payment);
            const bookingId = payment.bookingId;
            const filter = {_id : ObjectId(bookingId)}
            const updatedDoc = {
                $set: {
                    transationId: payment.transationId,
                    paid: true
                }
            }
            const bookingUpdateResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })
    }
    catch(error) {
        console.log(error)
    }
}

run().catch(console.log)