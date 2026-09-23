const API = 'http://localhost:4000';
const results = { client: [], cleaner: [], admin: [], shared: [], fixes: [] };

function ok(role, name, detail = '') {
  results[role].push({ status: 'PASS', name, detail });
  console.log(`PASS [${role}] ${name}${detail ? ': ' + detail : ''}`);
}
function fail(role, name, detail = '') {
  results[role].push({ status: 'FAIL', name, detail });
  console.log(`FAIL [${role}] ${name}: ${detail}`);
}
function note(role, name, detail = '') {
  results[role].push({ status: 'NOTE', name, detail });
  console.log(`NOTE [${role}] ${name}: ${detail}`);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function login(email) {
  const { status, data } = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'password123' },
  });
  if (status !== 200) throw new Error(`login ${email} failed: ${status} ${JSON.stringify(data)}`);
  return data;
}

const HUB = { lat: 51.5074, lng: -0.1278 };

async function main() {
  try {
    const clientLogin = await login('client@demo.com');
    if (clientLogin.user.role === 'client') ok('shared', 'Sign in as client');
    else fail('shared', 'Sign in as client', clientLogin.user.role);
  } catch (e) {
    fail('shared', 'Sign in as client', e.message);
  }

  try {
    const c1 = await login('cleaner1@demo.com');
    if (c1.user.role === 'cleaner') ok('shared', 'Sign in as cleaner');
    else fail('shared', 'Sign in as cleaner', c1.user.role);
  } catch (e) {
    fail('shared', 'Sign in as cleaner', e.message);
  }

  try {
    const adminLogin = await login('admin@demo.com');
    if (adminLogin.user.role === 'admin') ok('shared', 'Sign in as admin');
    else fail('shared', 'Sign in as admin', adminLogin.user.role);
  } catch (e) {
    fail('shared', 'Sign in as admin', e.message);
  }

  const client = await login('client@demo.com');
  const cleaner1 = await login('cleaner1@demo.com');
  const cleaner2 = await login('cleaner2@demo.com');
  const cleanerFar = await login('cleaner-far@demo.com');
  const admin = await login('admin@demo.com');

  await api('/api/cleaners/availability', {
    method: 'POST',
    token: cleaner1.token,
    body: { isAvailable: true, lat: HUB.lat + 0.01, lng: HUB.lng + 0.01 },
  });
  await api('/api/cleaners/availability', {
    method: 'POST',
    token: cleaner2.token,
    body: { isAvailable: true, lat: HUB.lat - 0.008, lng: HUB.lng + 0.005 },
  });
  await api('/api/cleaners/availability', {
    method: 'POST',
    token: cleanerFar.token,
    body: { isAvailable: true, lat: 51.9, lng: -0.5 },
  });

  let req1;
  {
    const { status, data } = await api('/api/requests', {
      method: 'POST',
      token: client.token,
      body: {
        serviceDetails: 'Office deep clean tomorrow',
        scheduleStart: new Date(Date.now() + 86400000).toISOString(),
        scheduleEnd: new Date(Date.now() + 2 * 86400000).toISOString(),
        address: '10 Downing Street, London', latitude: HUB.lat, longitude: HUB.lng,
      },
    });
    if (status === 201 && data.status === 'open') {
      ok('client', 'Post a cleaning need', `status=${data.status}`);
      req1 = data;
    } else fail('client', 'Post a cleaning need', `${status} ${JSON.stringify(data)}`);
  }

  if (req1) {
    if (req1.notifiedCleanerCount >= 2) {
      ok('client', 'See nearby cleaners notified', `count=${req1.notifiedCleanerCount}`);
    } else {
      fail('client', 'See nearby cleaners notified', `count=${req1.notifiedCleanerCount}`);
    }

    const farOffers = await api('/api/requests/offers', { token: cleanerFar.token });
    const hasFar = (farOffers.data || []).some((o) => String(o.request?.id) === String(req1._id));
    if (!hasFar) ok('shared', 'Proximity matching excludes far cleaners');
    else fail('shared', 'Proximity matching excludes far cleaners', 'far cleaner got offer');
  }

  {
    const { status, data } = await api('/api/notifications', { token: client.token });
    if (status === 200 && Array.isArray(data) && data.some((n) => n.type === 'matching_started')) {
      ok('client', 'Notification: matching started');
    } else {
      fail('client', 'Notification: matching started', JSON.stringify(data?.slice?.(0, 2) || data));
    }
  }

  {
    const { status, data } = await api('/api/requests/mine', { token: client.token });
    if (status === 200 && data.some((r) => r._id === req1._id && r.status === 'open')) {
      ok('client', 'Track request while open');
    } else {
      fail('client', 'Track request while open', `${status}`);
    }
  }

  {
    const { status, data } = await api(`/api/requests/${req1._id}`, {
      method: 'PATCH',
      token: client.token,
      body: { serviceDetails: 'Office deep clean tomorrow (updated)' },
    });
    if (status === 200 && data.serviceDetails.includes('updated')) {
      ok('client', 'Update request before cleaner locked in');
    } else {
      fail('client', 'Update request before cleaner locked in', `${status} ${JSON.stringify(data)}`);
    }
  }

  {
    const { data: cancelReq } = await api('/api/requests', {
      method: 'POST',
      token: client.token,
      body: {
        serviceDetails: 'Cancel me',
        scheduleStart: new Date(Date.now() + 86400000).toISOString(),
        scheduleEnd: new Date(Date.now() + 2 * 86400000).toISOString(),
        address: 'Somewhere', latitude: HUB.lat, longitude: HUB.lng,
      },
    });
    const { status, data: cancelled } = await api(`/api/requests/${cancelReq._id}/cancel`, {
      method: 'POST',
      token: client.token,
    });
    if (status === 200 && cancelled.status === 'cancelled') {
      ok('client', 'Cancel request before cleaner locked in');
    } else {
      fail('client', 'Cancel request before cleaner locked in', `${status} ${JSON.stringify(cancelled)}`);
    }
  }

  {
    const { status, data } = await api('/api/cleaners/availability', {
      method: 'POST',
      token: cleaner1.token,
      body: { isAvailable: true, lat: HUB.lat + 0.01, lng: HUB.lng + 0.01 },
    });
    if (status === 200 && data.isAvailable) ok('cleaner', 'Go available with location');
    else fail('cleaner', 'Go available with location', `${status}`);
  }

  {
    await api('/api/cleaners/availability', {
      method: 'POST',
      token: cleaner1.token,
      body: { isAvailable: false },
    });
    const me = await api('/api/auth/me', { token: cleaner1.token });
    if (me.data.isAvailable === false) ok('cleaner', 'Go unavailable');
    else fail('cleaner', 'Go unavailable', JSON.stringify(me.data));
    await api('/api/cleaners/availability', {
      method: 'POST',
      token: cleaner1.token,
      body: { isAvailable: true, lat: HUB.lat + 0.01, lng: HUB.lng + 0.01 },
    });
  }

  {
    const { status, data } = await api('/api/requests/offers', { token: cleaner1.token });
    const pending = (data || []).filter(
      (o) => o.offer?.status === 'pending' && String(o.request?.id) === String(req1._id)
    );
    if (status === 200 && pending.length === 1 && typeof pending[0].offer.distanceKm === 'number') {
      ok('cleaner', 'See nearby request board with distance', `${pending[0].offer.distanceKm} km`);
    } else {
      fail('cleaner', 'See nearby request board with distance', JSON.stringify(pending));
    }
  }

  {
    const { data } = await api('/api/requests/offers', { token: cleaner2.token });
    const pending = (data || []).some(
      (o) => o.offer?.status === 'pending' && String(o.request?.id) === String(req1._id)
    );
    if (pending) ok('cleaner', 'Open board: multiple cleaners see same offer');
    else fail('cleaner', 'Open board: multiple cleaners see same offer');
  }

  {
    const { data } = await api('/api/notifications', { token: cleaner1.token });
    if (Array.isArray(data) && data.some((n) => n.type === 'new_offer')) {
      ok('cleaner', 'Receive notification for nearby request');
    } else {
      fail('cleaner', 'Receive notification for nearby request', JSON.stringify(data?.slice?.(0, 2)));
    }
  }

  {
    const { status, data } = await api(`/api/requests/${req1._id}/respond`, {
      method: 'POST',
      token: cleaner2.token,
      body: { action: 'reject' },
    });
    if (status === 200) {
      const offer = data.offers?.find((o) => String(o.cleanerId) === String(cleaner2.user.id));
      if (offer?.status === 'rejected' && data.status === 'open') {
        ok('cleaner', 'Reject offer (request stays open)');
      } else {
        fail('cleaner', 'Reject offer (request stays open)', `offer=${offer?.status} req=${data.status}`);
      }
    } else {
      fail('cleaner', 'Reject offer (request stays open)', `${status} ${JSON.stringify(data)}`);
    }
  }

  {
    const { data: ignoreReq } = await api('/api/requests', {
      method: 'POST',
      token: client.token,
      body: {
        serviceDetails: 'Ignore test job',
        scheduleStart: new Date(Date.now() + 86400000).toISOString(),
        scheduleEnd: new Date(Date.now() + 2 * 86400000).toISOString(),
        address: 'Ignore St', latitude: HUB.lat, longitude: HUB.lng,
      },
    });
    const { status, data: resp } = await api(`/api/requests/${ignoreReq._id}/respond`, {
      method: 'POST',
      token: cleaner2.token,
      body: { action: 'ignore' },
    });
    const offer = resp.offers?.find((o) => String(o.cleanerId) === String(cleaner2.user.id));
    if (status === 200 && offer?.status === 'ignored' && resp.status === 'open') {
      ok('cleaner', 'Ignore offer (request stays open)');
    } else {
      fail('cleaner', 'Ignore offer (request stays open)', `${status} offer=${offer?.status}`);
    }
  }

  {
    const { status, data } = await api(`/api/requests/${req1._id}/respond`, {
      method: 'POST',
      token: cleaner1.token,
      body: { action: 'accept' },
    });
    if (
      status === 200 &&
      data.status === 'assigned' &&
      String(data.assignedCleanerId) === String(cleaner1.user.id)
    ) {
      ok('cleaner', 'Accept offer — becomes assigned');
    } else {
      fail(
        'cleaner',
        'Accept offer — becomes assigned',
        `${status} ${JSON.stringify({ status: data.status, assigned: data.assignedCleanerId })}`
      );
    }
  }

  {
    const { data: raceReq } = await api('/api/requests', {
      method: 'POST',
      token: client.token,
      body: {
        serviceDetails: 'Race accept job',
        scheduleStart: new Date(Date.now() + 86400000).toISOString(),
        scheduleEnd: new Date(Date.now() + 2 * 86400000).toISOString(),
        address: 'Race St', latitude: HUB.lat, longitude: HUB.lng,
      },
    });
    await api(`/api/requests/${raceReq._id}/respond`, {
      method: 'POST',
      token: cleaner1.token,
      body: { action: 'accept' },
    });
    const { status, data: failData } = await api(`/api/requests/${raceReq._id}/respond`, {
      method: 'POST',
      token: cleaner2.token,
      body: { action: 'accept' },
    });
    if (status === 409) {
      ok('cleaner', 'Know request no longer available after other accepts', failData.error);
    } else {
      fail(
        'cleaner',
        'Know request no longer available after other accepts',
        `${status} ${JSON.stringify(failData)}`
      );
    }
  }

  {
    const { data } = await api('/api/requests/mine', { token: client.token });
    const r = data.find((x) => x._id === req1._id);
    if (r?.status === 'assigned' && r.assignedCleanerId) {
      ok(
        'client',
        'Follow booking after acceptance (see assigned cleaner)',
        r.assignedCleanerId.name || String(r.assignedCleanerId)
      );
    } else {
      fail('client', 'Follow booking after acceptance (see assigned cleaner)', JSON.stringify(r));
    }
  }

  {
    const { status, data } = await api(`/api/requests/${req1._id}/cancel`, {
      method: 'POST',
      token: client.token,
    });
    if (status === 409) ok('client', 'Block cancel after cleaner locked in', data.error);
    else fail('client', 'Block cancel after cleaner locked in', `${status} ${JSON.stringify(data)}`);
  }

  const steps = ['en_route', 'on_site', 'in_progress', 'completed'];
  let progressOk = true;
  for (const step of steps) {
    const { status, data } = await api(`/api/requests/${req1._id}/progress`, {
      method: 'POST',
      token: cleaner1.token,
      body: { status: step },
    });
    if (status !== 200 || data.status !== step) {
      fail('cleaner', `Advance booking to ${step}`, `${status} ${JSON.stringify(data)}`);
      progressOk = false;
      break;
    }
  }
  if (progressOk) {
    ok('cleaner', 'Move job through on-the-way / on-site / in progress / completed');
  }

  {
    const { data } = await api('/api/requests/mine', { token: client.token });
    const r = data.find((x) => x._id === req1._id);
    if (r?.status === 'completed') ok('client', 'See job completed');
    else fail('client', 'See job completed', r?.status);
  }

  {
    const { data } = await api('/api/requests/offers', { token: cleaner1.token });
    const hist = (data || []).filter((o) => o.offer && o.offer.status !== 'pending');
    const hasAccepted = hist.some((o) => o.offer.status === 'accepted');
    if (hasAccepted) ok('cleaner', 'See history of accepted/rejected/ignored');
    else fail('cleaner', 'See history of accepted/rejected/ignored', `hist=${hist.length}`);
  }

  {
    const { data } = await api('/api/requests/offers', { token: cleaner2.token });
    const hasRejected = (data || []).some((o) => o.offer?.status === 'rejected');
    const hasIgnored = (data || []).some((o) => o.offer?.status === 'ignored');
    if (hasRejected && hasIgnored) ok('cleaner', 'History records reject and ignore');
    else fail('cleaner', 'History records reject and ignore', `rej=${hasRejected} ign=${hasIgnored}`);
  }

  {
    await api('/api/cleaners/availability', {
      method: 'POST',
      token: cleaner1.token,
      body: { isAvailable: false },
    });
    await api('/api/cleaners/availability', {
      method: 'POST',
      token: cleaner2.token,
      body: { isAvailable: false },
    });
    await api('/api/cleaners/availability', {
      method: 'POST',
      token: cleanerFar.token,
      body: { isAvailable: false },
    });
    const { data } = await api('/api/requests', {
      method: 'POST',
      token: client.token,
      body: {
        serviceDetails: 'No cleaners available job',
        scheduleStart: new Date(Date.now() + 86400000).toISOString(),
        scheduleEnd: new Date(Date.now() + 2 * 86400000).toISOString(),
        address: 'Empty', latitude: HUB.lat, longitude: HUB.lng,
      },
    });
    if (data.status === 'unmatched') {
      ok('client', 'Informed when no cleaners nearby (unmatched)');
    } else {
      fail('client', 'Informed when no cleaners nearby (unmatched)', data.status);
    }
    await api('/api/cleaners/availability', {
      method: 'POST',
      token: cleaner1.token,
      body: { isAvailable: true, lat: HUB.lat + 0.01, lng: HUB.lng + 0.01 },
    });
    await api('/api/cleaners/availability', {
      method: 'POST',
      token: cleaner2.token,
      body: { isAvailable: true, lat: HUB.lat - 0.008, lng: HUB.lng + 0.005 },
    });
  }

  {
    const { status, data } = await api('/api/admin/requests', { token: admin.token });
    if (status === 200 && Array.isArray(data) && data.length > 0) {
      ok('admin', 'View open and historical requests', `${data.length} requests`);
    } else {
      fail('admin', 'View open and historical requests', `${status}`);
    }
  }

  {
    const { data } = await api('/api/admin/requests', { token: admin.token });
    const openOne = data.find((r) => r.status === 'open') || data[0];
    const detail = await api(`/api/admin/requests/${openOne._id}`, { token: admin.token });
    if (detail.status === 200 && Array.isArray(detail.data.offers)) {
      ok(
        'admin',
        'See matching trail (who offered / accepted / rejected / ignored)',
        `offers=${detail.data.offers.length}`
      );
    } else {
      fail('admin', 'See matching trail', `${detail.status}`);
    }
  }

  {
    const { status, data } = await api('/api/admin/users', { token: admin.token });
    if (status === 200 && data.some((u) => u.role === 'client') && data.some((u) => u.role === 'cleaner')) {
      ok('admin', 'Oversee client/business and cleaner accounts', `${data.length} users`);
    } else {
      fail('admin', 'Oversee client/business and cleaner accounts', `${status}`);
    }
  }

  {
    const { status, data } = await api('/api/admin/stats', { token: admin.token });
    if (status === 200 && typeof data === 'object') {
      ok('admin', 'See overall activity stats', JSON.stringify(data));
    } else {
      fail('admin', 'See overall activity stats', `${status}`);
    }
  }

  {
    const { data: forceReq } = await api('/api/requests', {
      method: 'POST',
      token: client.token,
      body: {
        serviceDetails: 'Force assign me',
        scheduleStart: new Date(Date.now() + 86400000).toISOString(),
        scheduleEnd: new Date(Date.now() + 2 * 86400000).toISOString(),
        address: 'Force St', latitude: HUB.lat, longitude: HUB.lng,
      },
    });
    const { status, data: assigned } = await api(`/api/admin/requests/${forceReq._id}/force-assign`, {
      method: 'POST',
      token: admin.token,
      body: { cleanerId: cleaner2.user.id },
    });
    if (
      status === 200 &&
      assigned.status === 'assigned' &&
      String(assigned.assignedCleanerId) === String(cleaner2.user.id)
    ) {
      ok('admin', 'Force-assign a cleaner');
    } else {
      fail('admin', 'Force-assign a cleaner', `${status} ${JSON.stringify(assigned)}`);
    }
  }

  {
    const { data } = await api('/api/requests', {
      method: 'POST',
      token: client.token,
      body: {
        serviceDetails: 'Admin cancel me',
        scheduleStart: new Date(Date.now() + 86400000).toISOString(),
        scheduleEnd: new Date(Date.now() + 2 * 86400000).toISOString(),
        address: 'Cancel St', latitude: HUB.lat, longitude: HUB.lng,
      },
    });
    const { status, data: cancelled } = await api(`/api/admin/requests/${data._id}/cancel`, {
      method: 'POST',
      token: admin.token,
    });
    if (status === 200 && cancelled.status === 'cancelled') {
      ok('admin', 'Cancel / resolve a stuck request');
    } else {
      fail('admin', 'Cancel / resolve a stuck request', `${status}`);
    }
  }

  note(
    'client',
    'UI: update open request',
    'Client page now has Update + Cancel on open requests (PATCH + cancel APIs)'
  );

  console.log('\n========== SUMMARY ==========');
  for (const role of ['shared', 'client', 'cleaner', 'admin']) {
    const items = results[role];
    const pass = items.filter((i) => i.status === 'PASS').length;
    const failn = items.filter((i) => i.status === 'FAIL').length;
    const notes = items.filter((i) => i.status === 'NOTE').length;
    console.log(`\n${role.toUpperCase()}: ${pass} pass, ${failn} fail, ${notes} note`);
    for (const i of items) {
      if (i.status !== 'PASS') console.log(`  ${i.status}: ${i.name} — ${i.detail}`);
    }
  }

  const fs = await import('fs');
  fs.writeFileSync('capability-test-results.json', JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
