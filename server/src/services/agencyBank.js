import { CleaningAgency } from '../models/CleaningAgency.js';
import { CleaningRequest } from '../models/CleaningRequest.js';
import { BusinessMembership } from '../models/BusinessMembership.js';
import { User } from '../models/User.js';
import { isAgencyOwnerOrAdmin } from './agencyService.js';
import { isBusinessMember } from './businessService.js';
import { notDeletedFilter } from './requestService.js';
import { notify } from './notify.js';
import { enqueueEmail, htmlFromPlainText } from './emailQueue.js';
import { config } from '../config.js';

const BANK_FIELDS = '+bankAccountName +bankName +bankSortCode +bankAccountNumber';

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

export function formatSortCode(digits) {
  if (digits.length !== 6) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

export function bankToPublic(agency) {
  if (!agency?.bankAccountNumber || !agency?.bankSortCode) {
    return { provided: false };
  }
  return {
    provided: true,
    accountName: agency.bankAccountName,
    bankName: agency.bankName,
    sortCode: formatSortCode(agency.bankSortCode),
    accountNumber: agency.bankAccountNumber,
  };
}

function parseBankInput(body) {
  const accountName = String(body?.accountName || '').trim();
  const bankName = String(body?.bankName || '').trim();
  const sortCode = digitsOnly(body?.sortCode);
  const accountNumber = digitsOnly(body?.accountNumber);
  if (!accountName || accountName.length > 80) {
    throw httpError('Enter the account name (up to 80 characters)', 400);
  }
  if (!bankName || bankName.length > 80) {
    throw httpError('Enter the bank name (up to 80 characters)', 400);
  }
  if (sortCode.length !== 6) throw httpError('Enter a 6-digit sort code', 400);
  if (accountNumber.length !== 8) throw httpError('Enter an 8-digit account number', 400);
  return { accountName, bankName, sortCode, accountNumber };
}

export async function getAgencyBank(user, agencyId) {
  if (user.role !== 'cleaning_agency') throw httpError('Forbidden', 403);
  if (!(await isAgencyOwnerOrAdmin(user.id, agencyId))) throw httpError('Forbidden', 403);
  const agency = await CleaningAgency.findById(agencyId).select(`name ${BANK_FIELDS}`);
  if (!agency) throw httpError('Agency not found', 404);
  return { agencyId: agency._id, agencyName: agency.name, ...bankToPublic(agency) };
}

export async function saveAgencyBank(user, agencyId, body) {
  if (user.role !== 'cleaning_agency') throw httpError('Forbidden', 403);
  if (!(await isAgencyOwnerOrAdmin(user.id, agencyId))) throw httpError('Forbidden', 403);
  const next = parseBankInput(body);
  const agency = await CleaningAgency.findById(agencyId).select(`name ${BANK_FIELDS}`);
  if (!agency) throw httpError('Agency not found', 404);

  const changed =
    agency.bankAccountName !== next.accountName ||
    agency.bankName !== next.bankName ||
    agency.bankSortCode !== next.sortCode ||
    agency.bankAccountNumber !== next.accountNumber;

  agency.bankAccountName = next.accountName;
  agency.bankName = next.bankName;
  agency.bankSortCode = next.sortCode;
  agency.bankAccountNumber = next.accountNumber;
  await agency.save();

  if (changed) await queueBankDetailsShared(agency);
  return { agencyId: agency._id, agencyName: agency.name, ...bankToPublic(agency) };
}

export async function listBankDetailsForBusiness(user, businessId) {
  if (user.role !== 'business') throw httpError('Forbidden', 403);
  const bid = String(businessId || '').trim();
  if (!bid) throw httpError('businessId is required', 400);
  if (!(await isBusinessMember(user.id, bid))) throw httpError('Forbidden', 403);

  const jobs = await CleaningRequest.find({
    ...notDeletedFilter,
    businessId: bid,
    status: { $ne: 'cancelled' },
    $or: [{ assignedAgencyId: { $ne: null } }, { selectedAgencyId: { $ne: null } }],
  }).select('serviceDetails status assignedAgencyId selectedAgencyId');

  const byAgency = new Map();
  for (const job of jobs) {
    const agencyId = String(job.assignedAgencyId || job.selectedAgencyId || '');
    if (!agencyId) continue;
    if (!byAgency.has(agencyId)) byAgency.set(agencyId, []);
    byAgency.get(agencyId).push({
      requestId: job._id,
      serviceDetails: job.serviceDetails,
      status: job.status,
    });
  }
  if (!byAgency.size) return [];

  const agencies = await CleaningAgency.find({ _id: { $in: [...byAgency.keys()] } }).select(
    `name ${BANK_FIELDS}`
  );
  return agencies.map((agency) => ({
    agencyId: agency._id,
    agencyName: agency.name,
    ...bankToPublic(agency),
    jobs: byAgency.get(String(agency._id)) || [],
  }));
}

async function queueBankDetailsShared(agency) {
  try {
    const jobs = await CleaningRequest.find({
      ...notDeletedFilter,
      status: { $ne: 'cancelled' },
      businessId: { $ne: null },
      $or: [{ assignedAgencyId: agency._id }, { selectedAgencyId: agency._id }],
    }).select('businessId');
    const businessIds = [...new Set(jobs.map((job) => String(job.businessId)))];
    if (!businessIds.length) return;
    const memberships = await BusinessMembership.find({
      businessId: { $in: businessIds },
    }).select('userId');
    const userIds = [...new Set(memberships.map((row) => String(row.userId)))];
    const people = await User.find({ _id: { $in: userIds } }).select('name email');
    const details = bankToPublic(agency);
    const body = `${agency.name} shared official bank details. ${details.bankName}, sort code ${details.sortCode}, account ${details.accountNumber}.`;
    for (const person of people) {
      try {
        await notify(person._id, {
          type: 'agency_bank_details',
          title: 'Agency bank details',
          body,
        });
        if (!person.email) continue;
        const text = [
          `Hi ${person.name},`,
          '',
          `${agency.name} shared official bank details for a bank transfer.`,
          '',
          `Account name: ${details.accountName}`,
          `Bank: ${details.bankName}`,
          `Sort code: ${details.sortCode}`,
          `Account number: ${details.accountNumber}`,
          '',
          `View them in the app: ${config.clientOrigin}/client/bank`,
          'After you pay, upload the receipt from Upload receipt.',
        ].join('\n');
        enqueueEmail({
          to: person.email,
          subject: `${agency.name} shared bank details`,
          text,
          html: htmlFromPlainText(text),
          meta: { kind: 'agency_bank_details', userId: String(person._id), agencyId: String(agency._id) },
        });
      } catch (err) {
        console.error('[email] bank details notice failed', err.message);
      }
    }
  } catch (err) {
    console.error('[email] bank details notice failed', err.message);
  }
}
