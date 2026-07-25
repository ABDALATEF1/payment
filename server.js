  const crypto = require('crypto');
  require('dotenv').config();

  const express = require('express');
  const midtransClient = require('midtrans-client');
  const pool = require('./db');

  const cors = require('cors');
  const rateLimit = require('express-rate-limit');

  const app = express();

  app.set('trust proxy', 1);

  const limiter = rateLimit({
    windowMs: 1000,
    max: 5,
    message: {
      error: 'Too many requests'
    }
  });

  app.use(cors());
  app.use('/api/orders', limiter);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

    const path = require('path');

    app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'checkout.html'));
  });

  const snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
  });

  app.get('/', (req, res) => {
    res.send('Backend Running Successfully');
  });

  app.post('/api/orders', async (req, res) => {
    try {
      const orderId = 'ORDER-' + Date.now();

      const parameter = {
        transaction_details: {
          order_id: orderId,
          gross_amount: 50000
        }
      };

      const transaction = await snap.createTransaction(parameter);

  await pool.query(
    'INSERT INTO orders(order_id, amount, status) VALUES($1,$2,$3)',
    [orderId, 50000, 'pending']
  );

  res.json({
    order_id: orderId,
    token: transaction.token,
    redirect_url: transaction.redirect_url
  });

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  });

  app.post('/api/payment/notification', (req, res) => {
    console.log('Webhook:', req.body);

    res.status(200).json({
      message: 'Notification Received'
    });
  });

  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          order_id VARCHAR(255),
          amount INTEGER,
          status VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log('Orders table ready');
    } catch (err) {
      console.error(err);
    }
  })();

  app.get('/api/all-orders', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM orders ORDER BY id DESC'
      );

      res.json(result.rows);

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  });

  app.post('/api/midtrans/notification', async (req, res) => {
  try {

    console.log("=== MIDTRANS WEBHOOK ===");
    console.log("HEADERS:", req.headers);
    console.log("BODY:", req.body);
    console.log("========================");

    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(200).json({
        message: 'Empty body received'
      });
    }

    const orderId = req.body.order_id;
    const transactionStatus = req.body.transaction_status;
    const paymentType = req.body.payment_type;

    const statusCode = req.body.status_code;
    const grossAmount = req.body.gross_amount;
    const signatureKey = req.body.signature_key;

    const generatedSignature = crypto
      .createHash('sha512')
      .update(
        orderId +
        statusCode +
        grossAmount +
        process.env.MIDTRANS_SERVER_KEY
      )
      .digest('hex');

    console.log("GENERATED:", generatedSignature);
    console.log("MIDTRANS :", signatureKey);

    if (generatedSignature !== signatureKey) {
      console.log("INVALID SIGNATURE");

      return res.status(403).json({
        message: 'Invalid Signature'
      });
    }

    await pool.query(
      `UPDATE orders
       SET transaction_status=$1,
           payment_type=$2,
           status=$1
       WHERE order_id=$3`,
      [transactionStatus, paymentType, orderId]
    );

    console.log("ORDER UPDATED:", orderId);

    res.status(200).json({
      message: 'Webhook received and processed'
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});
app.listen(3000, () => {
  console.log('Server Started On Port 3000');
  });