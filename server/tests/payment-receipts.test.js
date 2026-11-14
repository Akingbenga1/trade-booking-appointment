import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/db.js';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';
import { Business } from '../src/models/Business.js';
import { BusinessMembership } from '../src/models/BusinessMembership.js';
import { CleaningAgency } from '../src/models/CleaningAgency.js';
import { AgencyMembership } from '../src/models/AgencyMembership.js';
import { CleaningRequest } from '../src/models/CleaningRequest.js';
import { BusinessPayment } from '../src/models/BusinessPayment.js';
import { Transaction } from '../src/models/Transaction.js';
import { PaymentReceipt } from '../src/models/PaymentReceipt.js';
import { Notification } from '../src/models/Notification.js';
import {
  listReceiptJobsForBusiness,
  listReceiptsForAgency,
  markJobPaidFromReceipt,
  listReceiptsForCleaner,
  markJobPaidByCleaner,
  readReceiptFile,
  savePaymentReceipt,
} from '../src/services/receiptService.js';
import { listBusinessTransactions } from '../src/services/paymentService.js';
import { _takeRecordedEmails } from '../src/services/emailQueue.js';
import { flushDeliveryQueue } from '../src/services/deliveryQueue.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('payment receipts', () => {
  let businessUser;
  let otherBusinessUser;
  let agencyOwner;
  let otherAgencyOwner;
  let business;
  let agency;
  let otherAgency;
  let job;

  before(async () => {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/trade_booking_test_receipts';
    delete process.env.MEMORY_MONGO;
    config.mongoUri = process.env.MONGO_URI;
    await connectDb();
    await Promise.all([
      User.deleteMany({}),
      Business.deleteMany({}),
      BusinessMembership.deleteMany({}),
      CleaningAgency.deleteMany({}),
      AgencyMembership.deleteMany({}),
      CleaningRequest.deleteMany({}),
      BusinessPayment.deleteMany({}),
      Transaction.deleteMany({}),
      PaymentReceipt.deleteMany({}),
      Notification.deleteMany({}),
    ]);

    businessUser = await User.create({
      name: 'Biz Owner',
      email: 'receipt-biz@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'business',
    });
    otherBusinessUser = await User.create({
      name: 'Other Biz',
      email: 'receipt-other-biz@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'business',
    });
    agencyOwner = await User.create({
      name: 'Agency Owner',
      email: 'receipt-agency@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });
    otherAgencyOwner = await User.create({
      name: 'Other Agency',
      email: 'receipt-other-agency@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });
    business = await Business.create({
      name: 'Receipt Ltd',
      phone: '+440200000777',
      address: '1 Receipt Road',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: businessUser._id,
    });
    await BusinessMembership.create({
      businessId: business._id,
      userId: businessUser._id,
      memberRole: 'owner',
    });
    agency = await CleaningAgency.create({
      name: 'Receipt Agency',
      phone: '+440200000888',
      address: '2 Agency Road',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: agencyOwner._id,
    });
    otherAgency = await CleaningAgency.create({
      name: 'Wrong Agency',
      phone: '+440200000999',
      address: '3 Agency Road',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: otherAgencyOwner._id,
    });
    await AgencyMembership.create({
      agencyId: agency._id,
      userId: agencyOwner._id,
      memberRole: 'owner',
    });
    await AgencyMembership.create({
      agencyId: otherAgency._id,
      userId: otherAgencyOwner._id,
      memberRole: 'owner',
    });
    job = await CleaningRequest.create({
      clientId: businessUser._id,
      businessId: business._id,
      serviceDetails: 'Receipt lobby',
      scheduleStart: new Date('2026-12-01T09:00:00Z'),
      scheduleEnd: new Date('2026-12-01T17:00:00Z'),
      address: '22 Business Row, London',
      latitude: 51.5,
      longitude: -0.12,
      status: 'assigned',
      assignedAgencyId: agency._id,
    });
    const transaction = await Transaction.create({
      requestId: job._id,
      amount: 80,
      currency: 'GBP',
      status: 'unpaid',
    });
    await BusinessPayment.create({
      businessId: business._id,
      requestId: job._id,
      transactionId: transaction._id,
      payRatePerHour: 14,
      minimumWagePerHour: 12.71,
      durationHours: 8,
    });
  });

  after(async () => {
    await disconnectDb();
  });

  it('lets the business upload a receipt and the agency mark the job paid', async () => {
    const biz = { id: businessUser._id, role: 'business' };
    const agencyUser = { id: agencyOwner._id, role: 'cleaning_agency' };

    await assert.rejects(
      () =>
        savePaymentReceipt(biz, {
          requestId: job._id,
          agencyId: agency._id,
          buffer: Buffer.from('not a real image'),
          originalName: 'fake.png',
          mimeType: 'image/png',
        }),
      /does not look like/
    );

    _takeRecordedEmails();
    const saved = await savePaymentReceipt(biz, {
      requestId: job._id,
      agencyId: agency._id,
      buffer: png,
      originalName: 'bank-transfer.png',
      mimeType: 'image/png',
      statedAmount: 50,
    });
    await assert.rejects(
      () => markJobPaidFromReceipt(agencyUser, agency._id, saved._id),
      /Confirm that you checked the file/
    );
    saved.statedAmount = 80;
    await saved.save();
    const uploadedMail = _takeRecordedEmails();
    assert.equal(uploadedMail.length, 1);
    assert.equal(uploadedMail[0].kind, 'payment_receipt');
    assert.equal(uploadedMail[0].to, 'receipt-agency@test.com');
    assert.match(uploadedMail[0].text, /Receipt lobby/);
    assert.match(uploadedMail[0].text, /£80\.00/);
    assert.equal(uploadedMail[0].text.includes('uploads/'), false);
    const agencyNotes = await Notification.find({ userId: agencyOwner._id, type: 'payment_receipt' });
    assert.equal(agencyNotes.length, 1);
    assert.equal(
      await Notification.countDocuments({ userId: otherAgencyOwner._id }),
      0
    );

    const jobs = await listReceiptJobsForBusiness(biz, business._id);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].agencyName, 'Receipt Agency');
    assert.equal(String(jobs[0].receipt.id), String(saved._id));
    assert.equal(jobs[0].paymentStatus, 'unpaid');

    const listed = await listReceiptsForAgency(agencyUser, agency._id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].businessName, 'Receipt Ltd');
    assert.equal(listed[0].amount, 80);
    assert.equal(listed[0].paymentStatus, 'unpaid');

    const file = await readReceiptFile(agencyUser, saved._id);
    assert.equal(file.receipt.mimeType, 'image/png');

    _takeRecordedEmails();
    const marked = await markJobPaidFromReceipt(agencyUser, agency._id, saved._id, {
      confirmMismatch: false,
    });
    assert.equal(marked.alreadyPaid, false);
    const paidMail = _takeRecordedEmails();
    assert.equal(paidMail.length, 1);
    assert.equal(paidMail[0].kind, 'payment_marked_paid');
    assert.equal(paidMail[0].to, 'receipt-biz@test.com');
    assert.match(paidMail[0].text, /Receipt Agency/);
    assert.match(paidMail[0].text, /£80\.00/);
    const businessNotes = await Notification.find({
      userId: businessUser._id,
      type: 'payment_marked_paid',
    });
    assert.equal(businessNotes.length, 1);
    const transaction = await Transaction.findOne({ requestId: job._id });
    assert.equal(transaction.status, 'paid');
    assert.equal(transaction.provider, 'receipt');
    assert.ok(transaction.paidAt);
    const txs = await listBusinessTransactions(biz, business._id);
    const paidRow = txs.find((row) => String(row.requestId) === String(job._id));
    assert.equal(String(paidRow.receiptId), String(saved._id));
    assert.ok(paidRow.scheduleStart);

    const again = await markJobPaidFromReceipt(agencyUser, agency._id, saved._id);
    assert.equal(again.alreadyPaid, true);
    assert.equal(_takeRecordedEmails().length, 0);
  });

  it('blocks another business and another agency', async () => {
    const receipt = await PaymentReceipt.findOne({ requestId: job._id });
    await assert.rejects(
      () =>
        savePaymentReceipt(
          { id: otherBusinessUser._id, role: 'business' },
          {
            requestId: job._id,
            agencyId: agency._id,
            buffer: png,
            originalName: 'nope.png',
            mimeType: 'image/png',
            statedAmount: 80,
          }
        ),
      /Forbidden/
    );
    await assert.rejects(
      () =>
        listReceiptsForAgency(
          { id: otherAgencyOwner._id, role: 'cleaning_agency' },
          agency._id
        ),
      /Forbidden/
    );
    await assert.rejects(
      () =>
        markJobPaidFromReceipt(
          { id: otherAgencyOwner._id, role: 'cleaning_agency' },
          otherAgency._id,
          receipt._id
        ),
      /Receipt not found/
    );
  });

  it('lets a cleaner receive a receipt and blocks a mismatched amount', async () => {
    const cleaner = await User.create({
      name: 'Indie Cleaner',
      email: 'receipt-cleaner@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaner',
    });
    const cleanerJob = await CleaningRequest.create({
      clientId: businessUser._id,
      businessId: business._id,
      serviceDetails: 'Cleaner lobby',
      scheduleStart: new Date('2026-12-03T09:00:00Z'),
      scheduleEnd: new Date('2026-12-03T17:00:00Z'),
      address: '9 Cleaner Row, London',
      latitude: 51.5,
      longitude: -0.12,
      status: 'on_site',
      assignedCleanerId: cleaner._id,
    });
    const transaction = await Transaction.create({
      requestId: cleanerJob._id,
      amount: 40,
      currency: 'GBP',
      status: 'unpaid',
    });
    await BusinessPayment.create({
      businessId: business._id,
      requestId: cleanerJob._id,
      transactionId: transaction._id,
      payRatePerHour: 10,
      minimumWagePerHour: 12.71,
      durationHours: 4,
    });
    const biz = { id: businessUser._id, role: 'business' };
    const saved = await savePaymentReceipt(biz, {
      requestId: cleanerJob._id,
      cleanerUserId: cleaner._id,
      buffer: png,
      originalName: 'cleaner-pay.png',
      mimeType: 'image/png',
      statedAmount: 12,
    });
    const cleanerUser = { id: cleaner._id, role: 'cleaner' };
    const listed = await listReceiptsForCleaner(cleanerUser);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].statedAmount, 12);
    await assert.rejects(
      () => markJobPaidByCleaner(cleanerUser, saved._id),
      /Confirm that you checked the file/
    );
    const marked = await markJobPaidByCleaner(cleanerUser, saved._id, { confirmMismatch: true });
    assert.equal(marked.paymentStatus, 'paid');
    const updated = await Transaction.findById(transaction._id);
    assert.equal(updated.status, 'paid');
    await flushDeliveryQueue();
  });
});
