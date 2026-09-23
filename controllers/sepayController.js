const crypto = require('crypto');
const Order = require('../models/Order');
const PaymentSession = require('../models/PaymentSession');
const SePayTransaction = require('../models/SePayTransaction');
const { createConfirmedTransferOrder } = require('./orderController');

const normaliseAccountNumber = (value) => String(value || '').replace(/\s|\./g, '');

const reject = async (transaction, reason) => {
  transaction.status = 'rejected';
  transaction.reject_reason = reason;
  await transaction.save();
};

// SePay signs `${timestamp}.${rawBody}` with HMAC-SHA256. This controller must
// be used with express.raw(), before the app-wide JSON parser.
exports.receivePayment = async (req, res) => {
  try {
    const secret = process.env.SEPAY_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(503).json({ success: false, message: 'Payment webhook is not configured' });
    }
    const expectedAccount = normaliseAccountNumber(process.env.SEPAY_ACCOUNT_NUMBER);
    if (!expectedAccount) {
      return res.status(503).json({ success: false, message: 'Receiving account is not configured' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const timestamp = Number(req.get('x-sepay-timestamp'));
    const receivedSignature = req.get('x-sepay-signature') || '';

    if (!rawBody || !Number.isInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
      return res.status(401).json({ success: false, message: 'Invalid or expired webhook request' });
    }

    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex')}`;
    const received = Buffer.from(receivedSignature);
    const expected = Buffer.from(expectedSignature);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    const payload = JSON.parse(rawBody);
    const transactionId = String(payload.id || payload.transaction_id || '');
    const transferType = String(payload.transferType || payload.transfer_type || '').toLowerCase();
    const amount = Number(payload.transferAmount ?? payload.transfer_amount ?? 0);
    const paymentCode = String(payload.code || '').trim().toUpperCase();

    if (!transactionId || !['in', 'credit'].includes(transferType) || !Number.isFinite(amount) || amount <= 0 || !paymentCode) {
      return res.status(400).json({ success: false, message: 'Invalid payment payload' });
    }

    let transaction;
    try {
      transaction = await SePayTransaction.create({
        transaction_id: transactionId,
        payment_code: paymentCode,
        amount,
        account_number: normaliseAccountNumber(payload.accountNumber || payload.account_number),
        reference_code: String(payload.referenceCode || payload.reference_code || ''),
        status: 'received',
        payload,
      });
    } catch (error) {
      if (error?.code === 11000) {
        transaction = await SePayTransaction.findOne({ transaction_id: transactionId });
        if (!transaction || transaction.status !== 'received') {
          return res.status(200).json({ success: true, message: 'Transaction already processed' });
        }
      } else {
        throw error;
      }
    }

    if (expectedAccount && transaction.account_number !== expectedAccount) {
      await reject(transaction, 'Payment was sent to an unexpected account');
      return res.status(200).json({ success: true, message: 'Transaction ignored' });
    }

    // New QR flow: no Order exists yet. Claim the unexpired payment session
    // atomically, then create the order only after SePay has verified payment.
    const paymentSession = await PaymentSession.findOne({ payment_code: paymentCode });
    if (paymentSession) {
      if (paymentSession.status === 'confirmed') {
        transaction.status = 'confirmed';
        transaction.order_id = paymentSession.order_id;
        transaction.payment_session_id = paymentSession._id;
        await transaction.save();
        return res.status(200).json({ success: true, message: 'Payment already confirmed' });
      }
      if (paymentSession.status === 'pending' && paymentSession.expires_at <= new Date()) {
        paymentSession.status = 'expired';
        await paymentSession.save();
      }
      if (paymentSession.status === 'expired') {
        await reject(transaction, 'QR payment session has expired');
        return res.status(200).json({ success: true, message: 'Expired payment session ignored' });
      }
      if (paymentSession.status !== 'pending') {
        await reject(transaction, `Payment session is ${paymentSession.status}`);
        return res.status(200).json({ success: true, message: 'Transaction ignored' });
      }
      if (amount !== Number(paymentSession.amount)) {
        await reject(transaction, 'Transfer amount does not match the payment session');
        return res.status(200).json({ success: true, message: 'Transaction ignored' });
      }

      const claimedSession = await PaymentSession.findOneAndUpdate(
        { _id: paymentSession._id, status: 'pending', expires_at: { $gt: new Date() } },
        { $set: { status: 'processing', payment_transaction_id: transactionId } },
        { new: true },
      );
      if (!claimedSession) {
        await reject(transaction, 'Payment session could not be claimed before expiry');
        return res.status(200).json({ success: true, message: 'Transaction ignored' });
      }

      try {
        const order = await createConfirmedTransferOrder(claimedSession, transactionId);
        claimedSession.status = 'confirmed';
        claimedSession.order_id = order._id;
        await claimedSession.save();

        transaction.status = 'confirmed';
        transaction.order_id = order._id;
        transaction.payment_session_id = claimedSession._id;
        await transaction.save();
        return res.status(200).json({ success: true, message: 'Payment confirmed and order created' });
      } catch (error) {
        claimedSession.status = 'failed';
        claimedSession.failure_reason = error.message;
        await claimedSession.save();
        transaction.reject_reason = `Payment received but order creation failed: ${error.message}`;
        await transaction.save();
        console.error('[SePay] Confirmed payment could not create order:', error.message);
        return res.status(200).json({ success: false, message: 'Payment received but order creation needs review' });
      }
    }

    const order = await Order.findOne({
      payment_code: paymentCode,
      payment_method: 'transfer',
      payment_status: 'pending',
      status: { $nin: ['cancelled', 'returned'] },
    });
    if (!order) {
      // Recovery for the tiny window where the order was saved but the audit
      // log update was interrupted; a retried webhook can safely finish it.
      const alreadyPaidOrder = await Order.findOne({
        payment_transaction_id: transactionId,
        payment_status: 'paid',
      });
      if (alreadyPaidOrder) {
        transaction.status = 'confirmed';
        transaction.order_id = alreadyPaidOrder._id;
        await transaction.save();
        return res.status(200).json({ success: true, message: 'Payment already confirmed' });
      }
      await reject(transaction, 'No pending transfer order matches this payment code');
      return res.status(200).json({ success: true, message: 'Transaction ignored' });
    }
    if (amount !== Number(order.total_price)) {
      await reject(transaction, 'Transfer amount does not match the order total');
      return res.status(200).json({ success: true, message: 'Transaction ignored' });
    }

    order.payment_status = 'paid';
    order.paid_at = new Date();
    order.payment_transaction_id = transactionId;
    await order.save();

    transaction.status = 'confirmed';
    transaction.order_id = order._id;
    await transaction.save();

    return res.status(200).json({ success: true, message: 'Payment confirmed' });
  } catch (error) {
    console.error('[SePay] Payment webhook failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to process payment webhook' });
  }
};
