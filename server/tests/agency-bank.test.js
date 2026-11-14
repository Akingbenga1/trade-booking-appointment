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
import { Notification } from '../src/models/Notification.js';
import {
  getAgencyBank,
  listBankDetailsForBusiness,
  saveAgencyBank,
} from '../src/services/agencyBank.js';
import { getPaymentForRequest } from '../src/services/paymentService.js';
import { _takeRecordedEmails } from '../src/services/emailQueue.js';

describe('agency bank details', () => {
  let businessUser;
  let otherBusinessUser;
  let agencyOwner;
  let otherAgencyOwner;
  let business;
  let agency;
  let job;

  before(async () => {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/trade_booking_test_bank';
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
      Notification.deleteMany({}),
    ]);

    businessUser = await User.create({
      name: 'Biz Owner',
      email: 'bank-biz@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'business',
    });
    otherBusinessUser = await User.create({
      name: 'Other Biz',
      email: 'bank-other@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'business',
    });
    agencyOwner = await User.create({
      name: 'Agency Owner',
      email: 'bank-agency@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });
    otherAgencyOwner = await User.create({
      name: 'Other Agency',
      email: 'bank-other-agency@test.com',
      passwordHash: await bcrypt.hash('password123', 8),
      role: 'cleaning_agency',
    });
    business = await Business.create({
      name: 'Bank Ltd',
      phone: '+440200000111',
      address: '1 Bank Road',
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
      name: 'Bank Agency',
      phone: '+440200000222',
      address: '2 Bank Road',
      latitude: 51.5,
      longitude: -0.12,
      createdBy: agencyOwner._id,
    });
    const otherAgency = await CleaningAgency.create({
      name: 'Other Bank Agency',
      phone: '+440200000333',
      address: '3 Bank Road',
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
      serviceDetails: 'Bank lobby',
      scheduleStart: new Date('2026-12-02T09:00:00Z'),
      scheduleEnd: new Date('2026-12-02T17:00:00Z'),
      address: '22 Business Row, London',
      latitude: 51.5,
      longitude: -0.12,
      status: 'assigned',
      assignedAgencyId: agency._id,
    });
    const transaction = await Transaction.create({
      requestId: job._id,
      amount: 96,
      currency: 'GBP',
      status: 'unpaid',
    });
    await BusinessPayment.create({
      businessId: business._id,
      requestId: job._id,
      transactionId: transaction._id,
      payRatePerHour: 12,
      minimumWagePerHour: 12.71,
      durationHours: 8,
    });
  });

  after(async () => {
    await disconnectDb();
  });

  it('saves official bank details and shows them to the business', async () => {
    const owner = { id: agencyOwner._id, role: 'cleaning_agency' };
    const biz = { id: businessUser._id, role: 'business' };

    await assert.rejects(
      () =>
        saveAgencyBank(owner, agency._id, {
          accountName: 'Bank Agency',
          bankName: 'Example Bank',
          sortCode: '12',
          accountNumber: '12345678',
        }),
      /sort code/
    );

    _takeRecordedEmails();
    const saved = await saveAgencyBank(owner, agency._id, {
      accountName: 'Bank Agency Ltd',
      bankName: 'Example Bank',
      sortCode: '20-00-00',
      accountNumber: '12345678',
    });
    assert.equal(saved.sortCode, '20-00-00');
    assert.equal(saved.accountNumber, '12345678');
    assert.equal(saved.provided, true);

    const mail = _takeRecordedEmails();
    assert.equal(mail.length, 1);
    assert.equal(mail[0].kind, 'agency_bank_details');
    assert.equal(mail[0].to, 'bank-biz@test.com');
    assert.match(mail[0].text, /20-00-00/);
    assert.match(mail[0].text, /12345678/);
    const notes = await Notification.find({ userId: businessUser._id, type: 'agency_bank_details' });
    assert.equal(notes.length, 1);

    const again = await saveAgencyBank(owner, agency._id, {
      accountName: 'Bank Agency Ltd',
      bankName: 'Example Bank',
      sortCode: '200000',
      accountNumber: '12345678',
    });
    assert.equal(again.sortCode, '20-00-00');
    assert.equal(_takeRecordedEmails().length, 0);

    await assert.rejects(
      () => getAgencyBank({ id: otherAgencyOwner._id, role: 'cleaning_agency' }, agency._id),
      /Forbidden/
    );

    const rows = await listBankDetailsForBusiness(biz, business._id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].agencyName, 'Bank Agency');
    assert.equal(rows[0].accountNumber, '12345678');
    assert.equal(rows[0].jobs[0].serviceDetails, 'Bank lobby');

    await assert.rejects(
      () => listBankDetailsForBusiness({ id: otherBusinessUser._id, role: 'business' }, business._id),
      /Forbidden/
    );

    const payment = await getPaymentForRequest(job._id, biz);
    assert.equal(payment.agency.name, 'Bank Agency');
    assert.equal(payment.agency.bank.sortCode, '20-00-00');
  });
});
