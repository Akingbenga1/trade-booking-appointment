import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { BusinessPayment } from '../models/BusinessPayment.js';
import { Transaction } from '../models/Transaction.js';
import { PaymentReceipt } from '../models/PaymentReceipt.js';
import { Business } from '../models/Business.js';
import { CleaningAgency } from '../models/CleaningAgency.js';
import { isBusinessMember } from './businessService.js';
import { isAgencyOwnerOrAdmin } from './agencyService.js';
import { applyPaymentStatus } from './payments/core.js';
import { notify } from './notify.js';
import { enqueueEmail, htmlFromPlainText } from './emailQueue.js';
import { AgencyMembership } from '../models/AgencyMembership.js';
import { BusinessMembership } from '../models/BusinessMembership.js';
import { User } from '../models/User.js';
import { config } from '../config.js';

const ALLOWED = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const uploadDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../uploads/receipts'
);

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function looksLikeAllowedFile(mimeType, buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (mimeType === 'application/pdf') return buffer.subarray(0, 4).toString() === '%PDF';
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (mimeType === 'image/png') return buffer.subarray(0, 4).toString('hex') === '89504e47';
  if (mimeType === 'image/webp') {
    return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  }
  return false;
}

function safeDownloadName(name) {
  return String(name || 'receipt')
    .replace(/[/\\]/g, '')
    .replace(/"/g, '')
    .slice(0, 120);
}

function parseStatedAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    throw httpError('Enter the amount shown on the receipt', 400);
  }
  return Math.round(amount * 100) / 100;
}

function amountsDiffer(stated, jobAmount) {
  if (stated == null || jobAmount == null) return false;
  return Math.abs(Number(stated) - Number(jobAmount)) > 0.009;
}

function assertMismatchConfirmed(receipt, transaction, confirmMismatch) {
  if (!amountsDiffer(receipt.statedAmount, transaction.amount)) return;
  if (confirmMismatch) return;
  throw httpError(
    `The receipt says ${gbp(receipt.statedAmount)} and the job is ${gbp(transaction.amount)}. Confirm that you checked the file.`,
    409
  );
}

async function jobForBusinessUpload(user, requestId, { agencyId, cleanerUserId }) {
  const request = await CleaningRequest.findById(requestId);
  if (!request || request.deletedAt) throw httpError('Job not found', 404);
  if (!request.businessId) throw httpError('Only a business job can have a payment receipt', 400);
  if (!(await isBusinessMember(user.id, request.businessId))) throw httpError('Forbidden', 403);
  const forAgency =
    request.assignedAgencyId && String(request.assignedAgencyId) === String(agencyId || '');
  const forCleaner =
    !request.assignedAgencyId &&
    request.assignedCleanerId &&
    String(request.assignedCleanerId) === String(cleanerUserId || '');
  if (!forAgency && !forCleaner) {
    throw httpError('That agency or cleaner is not assigned to this job', 400);
  }
  const ownership = await BusinessPayment.findOne({ requestId: request._id });
  const transaction = ownership
    ? await Transaction.findById(ownership.transactionId)
    : null;
  if (!transaction) throw httpError('This job has no payment record', 400);
  return { request, transaction };
}

export async function listReceiptJobsForBusiness(user, businessId) {
  if (!businessId) throw httpError('businessId is required', 400);
  if (!(await isBusinessMember(user.id, businessId))) throw httpError('Forbidden', 403);

  const requests = await CleaningRequest.find({
    businessId,
    deletedAt: null,
    $or: [{ assignedAgencyId: { $ne: null } }, { assignedCleanerId: { $ne: null } }],
  })
    .select(
      'serviceDetails address status assignedAgencyId assignedCleanerId scheduleStart scheduleEnd updatedAt'
    )
    .sort({ updatedAt: -1 });

  const requestIds = requests.map((row) => row._id);
  const cleanerIds = requests.map((row) => row.assignedCleanerId).filter(Boolean);
  const [agencies, cleaners, ownership, receipts] = await Promise.all([
    CleaningAgency.find({
      _id: { $in: requests.map((row) => row.assignedAgencyId).filter(Boolean) },
    }).select('name'),
    cleanerIds.length ? User.find({ _id: { $in: cleanerIds } }).select('name') : [],
    requestIds.length ? BusinessPayment.find({ requestId: { $in: requestIds } }) : [],
    requestIds.length ? PaymentReceipt.find({ requestId: { $in: requestIds } }) : [],
  ]);
  const txIds = ownership.map((row) => row.transactionId).filter(Boolean);
  const transactions = txIds.length ? await Transaction.find({ _id: { $in: txIds } }) : [];

  const agencyName = new Map(agencies.map((row) => [String(row._id), row.name]));
  const cleanerName = new Map(cleaners.map((row) => [String(row._id), row.name]));
  const payByRequest = new Map(ownership.map((row) => [String(row.requestId), row]));
  const txById = new Map(transactions.map((row) => [String(row._id), row]));
  const receiptByRequest = new Map(receipts.map((row) => [String(row.requestId), row]));

  return requests.map((request) => {
    const pay = payByRequest.get(String(request._id));
    const tx = pay ? txById.get(String(pay.transactionId)) : null;
    const receipt = receiptByRequest.get(String(request._id));
    const hasAgency = Boolean(request.assignedAgencyId);
    return {
      requestId: request._id,
      serviceDetails: request.serviceDetails,
      address: request.address,
      scheduleStart: request.scheduleStart,
      scheduleEnd: request.scheduleEnd,
      requestStatus: request.status,
      agencyId: hasAgency ? request.assignedAgencyId : null,
      agencyName: hasAgency ? agencyName.get(String(request.assignedAgencyId)) || 'Agency' : null,
      cleanerId: hasAgency ? null : request.assignedCleanerId,
      cleanerName: hasAgency ? null : cleanerName.get(String(request.assignedCleanerId)) || 'Cleaner',
      amount: tx?.amount ?? null,
      currency: tx?.currency || 'GBP',
      paymentStatus: tx?.status || 'none',
      receipt: receipt
        ? {
            id: receipt._id,
            originalName: receipt.originalName,
            mimeType: receipt.mimeType,
            statedAmount: receipt.statedAmount ?? null,
            createdAt: receipt.createdAt,
          }
        : null,
    };
  });
}

export async function savePaymentReceipt(
  user,
  { requestId, agencyId, cleanerUserId, statedAmount, buffer, originalName, mimeType }
) {
  const ext = ALLOWED.get(mimeType);
  if (!ext) throw httpError('Upload a PDF or an image (JPG, PNG, or WebP)', 400);
  if (!looksLikeAllowedFile(mimeType, buffer)) {
    throw httpError('That file does not look like a PDF or an image', 400);
  }
  if (buffer.length > 5 * 1024 * 1024) throw httpError('The file must be 5 MB or smaller', 400);
  const amountOnReceipt = parseStatedAmount(statedAmount);

  const { request } = await jobForBusinessUpload(user, requestId, { agencyId, cleanerUserId });
  await fs.mkdir(uploadDir, { recursive: true });

  const storedName = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  await fs.writeFile(path.join(uploadDir, storedName), buffer);
  const payee = request.assignedAgencyId
    ? { agencyId: request.assignedAgencyId, cleanerUserId: null }
    : { agencyId: null, cleanerUserId: request.assignedCleanerId };

  const prior = await PaymentReceipt.findOne({ requestId: request._id });
  if (prior) {
    await fs.unlink(path.join(uploadDir, prior.storedName)).catch(() => {});
    prior.agencyId = payee.agencyId;
    prior.cleanerUserId = payee.cleanerUserId;
    prior.businessId = request.businessId;
    prior.uploadedBy = user.id;
    prior.originalName = safeDownloadName(originalName);
    prior.storedName = storedName;
    prior.mimeType = mimeType;
    prior.size = buffer.length;
    prior.statedAmount = amountOnReceipt;
    prior.markedPaidAt = undefined;
    prior.markedPaidBy = undefined;
    await prior.save();
    await queueReceiptUploaded(request, prior);
    return prior;
  }

  const created = await PaymentReceipt.create({
    requestId: request._id,
    businessId: request.businessId,
    agencyId: payee.agencyId,
    cleanerUserId: payee.cleanerUserId,
    statedAmount: amountOnReceipt,
    uploadedBy: user.id,
    originalName: safeDownloadName(originalName),
    storedName,
    mimeType,
    size: buffer.length,
  });
  await queueReceiptUploaded(request, created);
  return created;
}

async function receiptFileForUser(user, receiptId) {
  const receipt = await PaymentReceipt.findById(receiptId);
  if (!receipt) throw httpError('Receipt not found', 404);
  const isBusiness = user.role === 'business' && (await isBusinessMember(user.id, receipt.businessId));
  const isAgency =
    user.role === 'cleaning_agency' &&
    receipt.agencyId &&
    (await isAgencyOwnerOrAdmin(user.id, receipt.agencyId));
  const isCleaner =
    user.role === 'cleaner' &&
    receipt.cleanerUserId &&
    String(receipt.cleanerUserId) === String(user.id);
  if (!isBusiness && !isAgency && !isCleaner) throw httpError('Forbidden', 403);
  return {
    receipt,
    filePath: path.join(uploadDir, receipt.storedName),
    downloadName: safeDownloadName(receipt.originalName),
  };
}

export async function readReceiptFile(user, receiptId) {
  const found = await receiptFileForUser(user, receiptId);
  try {
    await fs.access(found.filePath);
  } catch {
    throw httpError('Receipt file is missing', 404);
  }
  return found;
}

export async function listReceiptsForAgency(user, agencyId) {
  if (user.role !== 'cleaning_agency') throw httpError('Forbidden', 403);
  if (!(await isAgencyOwnerOrAdmin(user.id, agencyId))) throw httpError('Forbidden', 403);

  const receipts = await PaymentReceipt.find({ agencyId }).sort({ createdAt: -1 });
  const requestIds = receipts.map((row) => row.requestId);
  const [requests, businesses, ownership] = await Promise.all([
    CleaningRequest.find({ _id: { $in: requestIds } }).select(
      'serviceDetails address status scheduleStart scheduleEnd'
    ),
    Business.find({ _id: { $in: receipts.map((row) => row.businessId) } }).select('name'),
    BusinessPayment.find({ requestId: { $in: requestIds } }),
  ]);
  const txIds = ownership.map((row) => row.transactionId).filter(Boolean);
  const transactions = txIds.length ? await Transaction.find({ _id: { $in: txIds } }) : [];
  const requestById = new Map(requests.map((row) => [String(row._id), row]));
  const businessName = new Map(businesses.map((row) => [String(row._id), row.name]));
  const payByRequest = new Map(ownership.map((row) => [String(row.requestId), row]));
  const txById = new Map(transactions.map((row) => [String(row._id), row]));

  return receipts.map((receipt) => {
    const request = requestById.get(String(receipt.requestId));
    const pay = payByRequest.get(String(receipt.requestId));
    const tx = pay ? txById.get(String(pay.transactionId)) : null;
    return {
      id: receipt._id,
      requestId: receipt.requestId,
      originalName: receipt.originalName,
      mimeType: receipt.mimeType,
      createdAt: receipt.createdAt,
      markedPaidAt: receipt.markedPaidAt || null,
      serviceDetails: request?.serviceDetails || 'Cleaning job',
      address: request?.address || '',
      scheduleStart: request?.scheduleStart || null,
      scheduleEnd: request?.scheduleEnd || null,
      statedAmount: receipt.statedAmount ?? null,
      requestStatus: request?.status || null,
      businessName: businessName.get(String(receipt.businessId)) || 'Business',
      amount: tx?.amount ?? null,
      currency: tx?.currency || 'GBP',
      paymentStatus: tx?.status || 'none',
    };
  });
}

export async function markJobPaidFromReceipt(user, agencyId, receiptId, { confirmMismatch } = {}) {
  if (user.role !== 'cleaning_agency') throw httpError('Forbidden', 403);
  if (!(await isAgencyOwnerOrAdmin(user.id, agencyId))) throw httpError('Forbidden', 403);

  const receipt = await PaymentReceipt.findById(receiptId);
  if (!receipt || String(receipt.agencyId) !== String(agencyId)) {
    throw httpError('Receipt not found', 404);
  }
  const request = await CleaningRequest.findById(receipt.requestId);
  if (!request || request.deletedAt || String(request.assignedAgencyId) !== String(agencyId)) {
    throw httpError('This job is no longer assigned to your agency', 409);
  }
  const ownership = await BusinessPayment.findOne({ requestId: request._id });
  const transaction = ownership ? await Transaction.findById(ownership.transactionId) : null;
  if (!transaction) throw httpError('This job has no payment record', 400);

  assertMismatchConfirmed(receipt, transaction, confirmMismatch);
  const alreadyPaid = transaction.status === 'paid';
  if (!alreadyPaid) {
    await applyPaymentStatus({
      transactionId: transaction._id,
      status: 'paid',
      provider: transaction.providerPaymentId ? transaction.provider : 'receipt',
      paidAt: new Date(),
    });
  }
  receipt.markedPaidAt = new Date();
  receipt.markedPaidBy = user.id;
  await receipt.save();
  if (!alreadyPaid) await queueJobMarkedPaid(request, transaction);
  return { alreadyPaid, paymentStatus: 'paid' };
}

export async function listReceiptsForCleaner(user) {
  if (user.role !== 'cleaner') throw httpError('Forbidden', 403);
  const receipts = await PaymentReceipt.find({ cleanerUserId: user.id }).sort({ createdAt: -1 });
  const requests = await CleaningRequest.find({
    _id: { $in: receipts.map((row) => row.requestId) },
  }).select('serviceDetails address status scheduleStart scheduleEnd businessId');
  const businesses = await Business.find({
    _id: { $in: requests.map((row) => row.businessId).filter(Boolean) },
  }).select('name');
  const ownership = await BusinessPayment.find({
    requestId: { $in: receipts.map((row) => row.requestId) },
  });
  const transactions = ownership.length
    ? await Transaction.find({ _id: { $in: ownership.map((row) => row.transactionId).filter(Boolean) } })
    : [];
  const requestById = new Map(requests.map((row) => [String(row._id), row]));
  const businessName = new Map(businesses.map((row) => [String(row._id), row.name]));
  const payByRequest = new Map(ownership.map((row) => [String(row.requestId), row]));
  const txById = new Map(transactions.map((row) => [String(row._id), row]));
  return receipts.map((receipt) => {
    const request = requestById.get(String(receipt.requestId));
    const pay = payByRequest.get(String(receipt.requestId));
    const tx = pay ? txById.get(String(pay.transactionId)) : null;
    return {
      id: receipt._id,
      requestId: receipt.requestId,
      originalName: receipt.originalName,
      mimeType: receipt.mimeType,
      createdAt: receipt.createdAt,
      statedAmount: receipt.statedAmount ?? null,
      serviceDetails: request?.serviceDetails || 'Cleaning job',
      address: request?.address || '',
      scheduleStart: request?.scheduleStart || null,
      scheduleEnd: request?.scheduleEnd || null,
      businessName: request ? businessName.get(String(request.businessId)) || 'Business' : 'Business',
      amount: tx?.amount ?? null,
      currency: tx?.currency || 'GBP',
      paymentStatus: tx?.status || 'none',
    };
  });
}

export async function markJobPaidByCleaner(user, receiptId, { confirmMismatch } = {}) {
  if (user.role !== 'cleaner') throw httpError('Forbidden', 403);
  const receipt = await PaymentReceipt.findById(receiptId);
  if (!receipt || String(receipt.cleanerUserId || '') !== String(user.id)) {
    throw httpError('Receipt not found', 404);
  }
  const request = await CleaningRequest.findById(receipt.requestId);
  if (
    !request ||
    request.deletedAt ||
    request.assignedAgencyId ||
    String(request.assignedCleanerId || '') !== String(user.id)
  ) {
    throw httpError('This job is no longer assigned to you', 409);
  }
  const ownership = await BusinessPayment.findOne({ requestId: request._id });
  const transaction = ownership ? await Transaction.findById(ownership.transactionId) : null;
  if (!transaction) throw httpError('This job has no payment record', 400);
  assertMismatchConfirmed(receipt, transaction, confirmMismatch);
  const alreadyPaid = transaction.status === 'paid';
  if (!alreadyPaid) {
    await applyPaymentStatus({
      transactionId: transaction._id,
      status: 'paid',
      provider: transaction.providerPaymentId ? transaction.provider : 'receipt',
      paidAt: new Date(),
    });
  }
  receipt.markedPaidAt = new Date();
  receipt.markedPaidBy = user.id;
  await receipt.save();
  if (!alreadyPaid) await queueJobMarkedPaid(request, transaction);
  return { alreadyPaid, paymentStatus: 'paid' };
}

function gbp(amount) {
  return `£${Number(amount).toFixed(2)}`;
}

async function peopleForMemberships(memberships) {
  const ids = memberships.map((row) => row.userId);
  if (!ids.length) return [];
  return User.find({ _id: { $in: ids } }).select('name email');
}

function jobTitle(request) {
  const when = request.scheduleStart
    ? new Date(request.scheduleStart).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/London',
      })
    : '';
  return when ? `${request.serviceDetails} (${when})` : request.serviceDetails;
}

async function queueReceiptUploaded(request, receipt) {
  if (!request.assignedAgencyId) {
    await queueCleanerReceipt(request, receipt);
    return;
  }
  try {
    const [business, memberships, pay] = await Promise.all([
      Business.findById(request.businessId).select('name'),
      AgencyMembership.find({
        agencyId: request.assignedAgencyId,
        memberRole: { $in: ['owner', 'admin'] },
      }).select('userId'),
      BusinessPayment.findOne({ requestId: request._id }).select('transactionId'),
    ]);
    const transaction = pay ? await Transaction.findById(pay.transactionId).select('amount') : null;
    const people = await peopleForMemberships(memberships);
    const businessName = business?.name || 'A business';
    const amount = transaction ? gbp(transaction.amount) : 'the agreed amount';
    const stated = receipt.statedAmount != null ? gbp(receipt.statedAmount) : 'not entered';
    const body = `${businessName} uploaded a payment receipt for ${jobTitle(request)}. The file says ${stated}. The job amount is ${amount}. Open Payment receipts to check the file and mark the job paid.`;
    for (const person of people) {
      try {
        await notify(person._id, {
          type: 'payment_receipt',
          title: 'Payment receipt uploaded',
          body,
          requestId: request._id,
        });
        if (!person.email) continue;
        const text = [
          `Hi ${person.name},`,
          '',
          body,
          '',
          `Job: ${jobTitle(request)}`,
          `Address: ${request.address}`,
          `Amount on the receipt: ${stated}`,
          `Job amount: ${amount}`,
          `File: ${receipt.originalName}`,
          '',
          `Open receipts: ${config.clientOrigin}/agency/receipts`,
        ].join('\n');
        enqueueEmail({
          to: person.email,
          subject: `${businessName} uploaded a payment receipt`,
          text,
          html: htmlFromPlainText(text),
          meta: {
            kind: 'payment_receipt',
            userId: String(person._id),
            requestId: String(request._id),
          },
        });
      } catch (err) {
        console.error('[email] payment receipt notice failed', err.message);
      }
    }
  } catch (err) {
    console.error('[email] payment receipt notice failed', err.message);
  }
}

async function queueCleanerReceipt(request, receipt) {
  try {
    const [cleaner, business] = await Promise.all([
      User.findById(request.assignedCleanerId).select('name email'),
      Business.findById(request.businessId).select('name'),
    ]);
    if (!cleaner) return;
    const businessName = business?.name || 'A business';
    const stated = receipt.statedAmount != null ? gbp(receipt.statedAmount) : 'not entered';
    const body = `${businessName} uploaded a payment receipt for ${jobTitle(request)}. The file says ${stated}. Open Payment receipts to check it and mark the job paid.`;
    await notify(cleaner._id, {
      type: 'payment_receipt',
      title: 'Payment receipt uploaded',
      body,
      requestId: request._id,
    });
    if (!cleaner.email) return;
    const text = [
      `Hi ${cleaner.name},`,
      '',
      body,
      '',
      `Job: ${jobTitle(request)}`,
      `Address: ${request.address}`,
      `File: ${receipt.originalName}`,
      '',
      `Open receipts: ${config.clientOrigin}/cleaner/receipts`,
    ].join('\n');
    enqueueEmail({
      to: cleaner.email,
      subject: `${businessName} uploaded a payment receipt`,
      text,
      html: htmlFromPlainText(text),
      meta: {
        kind: 'payment_receipt',
        userId: String(cleaner._id),
        requestId: String(request._id),
      },
    });
  } catch (err) {
    console.error('[email] cleaner receipt notice failed', err.message);
  }
}

async function queueJobMarkedPaid(request, transaction) {
  try {
    const [payer, memberships] = await Promise.all([
      request.assignedAgencyId
        ? CleaningAgency.findById(request.assignedAgencyId).select('name')
        : User.findById(request.assignedCleanerId).select('name'),
      BusinessMembership.find({ businessId: request.businessId }).select('userId'),
    ]);
    const people = await peopleForMemberships(memberships);
    const payerName = payer?.name || (request.assignedAgencyId ? 'The agency' : 'The cleaner');
    const amount = gbp(transaction.amount);
    const body = `${payerName} marked ${jobTitle(request)} as paid (${amount}) from your receipt.`;
    for (const person of people) {
      try {
        await notify(person._id, {
          type: 'payment_marked_paid',
          title: 'Job marked paid',
          body,
          requestId: request._id,
        });
        if (!person.email) continue;
        const text = [
          `Hi ${person.name},`,
          '',
          body,
          '',
          `Job: ${jobTitle(request)}`,
          `Address: ${request.address}`,
          `Amount: ${amount}`,
          '',
          `Open payments: ${config.clientOrigin}/client/payments`,
        ].join('\n');
        enqueueEmail({
          to: person.email,
          subject: `${payerName} marked your job paid`,
          text,
          html: htmlFromPlainText(text),
          meta: {
            kind: 'payment_marked_paid',
            userId: String(person._id),
            requestId: String(request._id),
          },
        });
      } catch (err) {
        console.error('[email] payment marked paid notice failed', err.message);
      }
    }
  } catch (err) {
    console.error('[email] payment marked paid notice failed', err.message);
  }
}
