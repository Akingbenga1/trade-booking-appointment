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

async function jobForBusinessUpload(user, requestId, agencyId) {
  const request = await CleaningRequest.findById(requestId);
  if (!request || request.deletedAt) throw httpError('Job not found', 404);
  if (!request.businessId) throw httpError('Only a business job can have a payment receipt', 400);
  if (!(await isBusinessMember(user.id, request.businessId))) throw httpError('Forbidden', 403);
  if (String(request.assignedAgencyId || '') !== String(agencyId)) {
    throw httpError('That agency is not assigned to this job', 400);
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
    assignedAgencyId: { $ne: null },
    deletedAt: null,
  })
    .select('serviceDetails address status assignedAgencyId updatedAt')
    .sort({ updatedAt: -1 });

  const requestIds = requests.map((row) => row._id);
  const [agencies, ownership, receipts] = await Promise.all([
    CleaningAgency.find({
      _id: { $in: requests.map((row) => row.assignedAgencyId) },
    }).select('name'),
    requestIds.length ? BusinessPayment.find({ requestId: { $in: requestIds } }) : [],
    requestIds.length ? PaymentReceipt.find({ requestId: { $in: requestIds } }) : [],
  ]);
  const txIds = ownership.map((row) => row.transactionId).filter(Boolean);
  const transactions = txIds.length ? await Transaction.find({ _id: { $in: txIds } }) : [];

  const agencyName = new Map(agencies.map((row) => [String(row._id), row.name]));
  const payByRequest = new Map(ownership.map((row) => [String(row.requestId), row]));
  const txById = new Map(transactions.map((row) => [String(row._id), row]));
  const receiptByRequest = new Map(receipts.map((row) => [String(row.requestId), row]));

  return requests.map((request) => {
    const pay = payByRequest.get(String(request._id));
    const tx = pay ? txById.get(String(pay.transactionId)) : null;
    const receipt = receiptByRequest.get(String(request._id));
    return {
      requestId: request._id,
      serviceDetails: request.serviceDetails,
      address: request.address,
      requestStatus: request.status,
      agencyId: request.assignedAgencyId,
      agencyName: agencyName.get(String(request.assignedAgencyId)) || 'Agency',
      amount: tx?.amount ?? null,
      currency: tx?.currency || 'GBP',
      paymentStatus: tx?.status || 'none',
      receipt: receipt
        ? {
            id: receipt._id,
            originalName: receipt.originalName,
            mimeType: receipt.mimeType,
            createdAt: receipt.createdAt,
          }
        : null,
    };
  });
}

export async function savePaymentReceipt(user, { requestId, agencyId, buffer, originalName, mimeType }) {
  const ext = ALLOWED.get(mimeType);
  if (!ext) throw httpError('Upload a PDF or an image (JPG, PNG, or WebP)', 400);
  if (!looksLikeAllowedFile(mimeType, buffer)) {
    throw httpError('That file does not look like a PDF or an image', 400);
  }
  if (buffer.length > 5 * 1024 * 1024) throw httpError('The file must be 5 MB or smaller', 400);

  const { request } = await jobForBusinessUpload(user, requestId, agencyId);
  await fs.mkdir(uploadDir, { recursive: true });

  const storedName = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  await fs.writeFile(path.join(uploadDir, storedName), buffer);

  const prior = await PaymentReceipt.findOne({ requestId: request._id });
  if (prior) {
    await fs.unlink(path.join(uploadDir, prior.storedName)).catch(() => {});
    prior.agencyId = request.assignedAgencyId;
    prior.businessId = request.businessId;
    prior.uploadedBy = user.id;
    prior.originalName = safeDownloadName(originalName);
    prior.storedName = storedName;
    prior.mimeType = mimeType;
    prior.size = buffer.length;
    prior.markedPaidAt = undefined;
    prior.markedPaidBy = undefined;
    await prior.save();
    await queueReceiptUploaded(request, prior);
    return prior;
  }

  const created = await PaymentReceipt.create({
    requestId: request._id,
    businessId: request.businessId,
    agencyId: request.assignedAgencyId,
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
    user.role === 'cleaning_agency' && (await isAgencyOwnerOrAdmin(user.id, receipt.agencyId));
  if (!isBusiness && !isAgency) throw httpError('Forbidden', 403);
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
    CleaningRequest.find({ _id: { $in: requestIds } }).select('serviceDetails address status'),
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
      requestStatus: request?.status || null,
      businessName: businessName.get(String(receipt.businessId)) || 'Business',
      amount: tx?.amount ?? null,
      currency: tx?.currency || 'GBP',
      paymentStatus: tx?.status || 'none',
    };
  });
}

export async function markJobPaidFromReceipt(user, agencyId, receiptId) {
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

async function queueReceiptUploaded(request, receipt) {
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
    const body = `${businessName} uploaded a payment receipt for ${request.serviceDetails} (${amount}). Open Payment receipts to check the file and mark the job paid.`;
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
          `Job: ${request.serviceDetails}`,
          `Address: ${request.address}`,
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

async function queueJobMarkedPaid(request, transaction) {
  try {
    const [agency, memberships] = await Promise.all([
      CleaningAgency.findById(request.assignedAgencyId).select('name'),
      BusinessMembership.find({ businessId: request.businessId }).select('userId'),
    ]);
    const people = await peopleForMemberships(memberships);
    const agencyName = agency?.name || 'The agency';
    const amount = gbp(transaction.amount);
    const body = `${agencyName} marked ${request.serviceDetails} as paid (${amount}) from your receipt.`;
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
          `Job: ${request.serviceDetails}`,
          `Address: ${request.address}`,
          `Amount: ${amount}`,
          '',
          `Open payments: ${config.clientOrigin}/client/payments`,
        ].join('\n');
        enqueueEmail({
          to: person.email,
          subject: `${agencyName} marked your job paid`,
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
