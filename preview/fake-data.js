/**
 * Made-up data in the same tabs and columns as the real sheets, for the local preview. Nobody here is a real person.
 * Seeded, so every run looks the same. Dates are 'yyyy-MM-dd' text, as the Sheets API hands them over.
 */
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = a => a[Math.floor(rnd() * a.length)];
const FIRST = ['Aarav', 'Diya', 'Kabir', 'Ananya', 'Rohan', 'Meera', 'Vihaan', 'Isha', 'Arjun', 'Saanvi', 'Reyansh', 'Kavya', 'Aditya', 'Nisha', 'Karan', 'Pooja',
  'Rahul', 'Sneha', 'Vikram', 'Priya', 'Siddharth', 'Tanvi', 'Nikhil', 'Riya', 'Harsh', 'Aisha', 'Manish', 'Divya', 'Yash', 'Shreya', 'Gaurav', 'Neha', 'Varun', 'Ishita'];
const LAST = ['Sharma', 'Reddy', 'Iyer', 'Nair', 'Gupta', 'Patel', 'Rao', 'Menon', 'Das', 'Kulkarni', 'Joshi', 'Verma', 'Bose', 'Pillai', 'Shetty', 'Mishra', 'Kapoor', 'Hegde'];
const CITIES = ['Bangalore', 'Bangalore', 'Bangalore', 'Pune', 'Hyderabad', 'Chennai', 'Mumbai', 'Noida'];
const SOURCES = ['Referral', 'Campus', 'Internal Sourcing', 'Internal Sourcing-Lateral', 'Job Portal', 'Walk-in'];
const DEPTS = [['Seller Prepaid Servicing', 'Seller Prepaid'], ['Tenant Servicing', 'TS/TSRP'], ['Buyer Acquisition & Property Sales', 'ASM 1'],
  ['Owner Servicing', 'OS-Calling'], ['PnM-Servicing', 'PnM-Servicing'], ['Legal Servicing', 'Legal-Calling (Servicing)'], ['Commercial Sales', 'Commercial Sales - OS']];
export const TRAINERS = [['aditi.rao@nobroker.in', 'Aditi Rao'], ['karthik.menon@nobroker.in', 'Karthik Menon'], ['sana.qureshi@nobroker.in', 'Sana Qureshi'],
  ['rohit.verma@nobroker.in', 'Rohit Verma'], ['neha.kulkarni@nobroker.in', 'Neha Kulkarni']];
export const MANAGER = 'priya.nair@nobroker.in';
const MENTOR = 'vikram.shah@nobroker.in';

const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);

export function build(today) {
  const T = Date.parse(today + 'T00:00:00Z');
  const D = n => iso(T + n * DAY);
  const stampOf = n => D(n) + ' 10:30:00';
  let empN = 50100;
  const person = wfh => {
    const fn = pick(FIRST), ln = pick(LAST), id = (wfh ? 'NBTSA30' : 'NBTS') + (empN++);
    return { id, name: fn + ' ' + ln, email: (fn + '.' + ln + (empN % 7)).toLowerCase() + '@nobroker.in', phone: 7000000000 + Math.floor(rnd() * 2999999999), wfh };
  };

  const head = ['DOJ', 'Work Mode', 'Emp ID', 'Employee Name', 'Official Email ID', 'Contact Number', 'Department', 'Sub-Team', 'Work Location', 'Trainer', 'Manager',
    'Employment Status', 'Lateral Hire', 'Training Start Date', 'Final KC Score%', 'Final KC Clearance / Fail Attempts', 'Final KC Status', 'Final Mock Clearance / Fail Attempts',
    'Final Mock Status', 'Final Mock/Training End Date', 'Total Training Days', 'OJT Start Date', 'OJT Achievement %', 'OJT End Date', 'Day of Attrition', 'Last Working Date', 'Mentor'];
  const md = [head], kc = [['Date of KC', 'Emp ID', 'Attempt', 'Obtained Percentage', 'Status']];
  const attDays = []; for (let k = 13; k >= 1; k--) attDays.push(-k);
  const att = [['Emp ID', 'Employee Name', 'Trainer', 'DOJ'].concat(attDays.map(D))];
  const mocks = [['Emp ID', 'Employee Name', 'Trainer', 'Mock Date', 'Attempt', 'Score %', 'Status', 'Final Attempt', 'Entered By', 'Approved By', 'Approved On']];
  const talk = { dates: [], ids: [], durations: [] };
  const hms = s => Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  TRAINERS.forEach(([temail], ti) => {
    [-150, -110, -80, -60, -42, -28, -16, -9, -3].forEach((s, bi) => {
      if (ti > 1 && bi % 2) return;
      const size = 4 + Math.floor(rnd() * 6), dept = pick(DEPTS);
      for (let k = 0; k < size; k++) {
        const p = person(rnd() < .3), doj = s - 2, age = -doj;
        const left = rnd() < .12 && age > 10, attr = left ? Math.min(age, 3 + Math.floor(rnd() * 40)) : '';
        const kcDone = age > 8, kcPass = rnd() < .8, mockDone = age > 18 && !left, mockPass = rnd() < .78;
        const tEnd = mockDone ? D(s + 14) : '', ojtStart = mockDone && mockPass && age > 20 ? D(s + 16) : '', ojtEnd = ojtStart ? D(s + 45) : '';
        md.push([D(doj), p.wfh ? 'WFH' : 'WFO', p.id, p.name, p.email, p.phone, dept[0], dept[1], pick(CITIES), temail, MANAGER, left ? 'Inactive' : 'Active', rnd() < .05 ? 'Yes' : 'No',
          D(s), kcDone ? 0.6 + rnd() * .38 : '', kcDone ? (kcPass ? '1st' : '2nd') : '', kcDone ? (kcPass ? 'Pass' : 'Fail') : '',
          mockDone ? (mockPass ? '1st' : '2nd') : '', mockDone ? (mockPass ? 'Pass' : 'Fail') : '', tEnd, mockDone ? 14 : '', ojtStart,
          ojtEnd && age > 50 ? 0.5 + rnd() * .55 : '', ojtEnd, attr, left ? D(doj + attr) : '', MENTOR]);
        if (kcDone) kc.push([D(s + 6), p.id, kcPass ? '1st' : '2nd', Math.round((60 + rnd() * 38) * 10) / 1000, kcPass ? 'Pass' : 'Fail']);
        if (age <= 46 && !left) {
          const row = [p.id, p.name, temail, D(doj)];
          attDays.forEach(k2 => { const on = doj <= k2, r = rnd(); row.push(on ? (r < .82 ? 'P' : r < .9 ? 'L' : r < .96 ? 'WO' : 'NCNS') : ''); });
          if (rnd() < .4) row[row.length - 1] = '';                 // leave some days unmarked
          att.push(row);
        }
        if (mockDone) mocks.push([p.id, p.name, temail, D(s + 14), mockPass ? '1st' : '2nd', '', mockPass ? 'Pass' : 'Fail', 'Yes', temail, 'No approval needed', stampOf(s + 14)]);
        if (mockDone && mockPass) {
          for (let d = s + 16; d < 0 && d <= s + 50; d++) {
            if (rnd() < .15) continue;
            talk.dates.push(D(d)); talk.ids.push(p.id); talk.durations.push(hms(Math.floor(1800 + rnd() * 9000)));
          }
        }
      }
    });
  });

  // HR sheets: new joiners (unclaimed) + everyone above
  const hrHead = ['E-Code', 'Employee Name', 'Status', 'DOJ', 'Contact Number', 'Official Email ID', 'Work Location', 'LWD', 'Source', 'Department'];
  const wfo = [hrHead], wfh = [hrHead.slice()];
  for (let i = 0; i < 260; i++) {
    const p = person(rnd() < .3), d = pick(DEPTS), j = -Math.floor(rnd() * 60);
    (p.wfh ? wfh : wfo).push([p.id, p.name, rnd() < .9 ? 'Active' : 'Inactive', D(j), p.phone, p.email, pick(CITIES), '', pick(SOURCES), d[0]]);
  }
  md.slice(1).forEach(r => wfo.push([r[2], r[3], r[11], r[0], r[5], r[4], r[8], '', pick(SOURCES), r[6]]));

  const sm = [new Array(15).fill('')];
  TRAINERS.forEach(([e]) => { const r = new Array(15).fill(''); r[12] = e; r[13] = MANAGER; r[14] = MENTOR; sm.push(r); });
  const trk = [['Emp ID', 'Name', 'Email', 'Manager']].concat(TRAINERS.map(([e, n], i) => ['T' + i, n, e, MANAGER]))
    .concat([['M1', 'Priya Nair', MANAGER, ''], ['M2', 'Vikram Shah', MENTOR, '']]);

  const months = [];
  for (let m = 8; m >= 0; m--) { const d = new Date(T); d.setUTCMonth(d.getUTCMonth() - m, 1); months.push(iso(d.getTime())); }
  const ir = [['Trainer'].concat(months)].concat(TRAINERS.map(([e]) => [e].concat(months.map(() => Math.floor(rnd() * 3)))));
  const tie = [['Date of Intervention', 'Closure Date', 'Trainer'], ['', '', '']];
  TRAINERS.forEach(([e]) => { for (let k = 0; k < 4; k++) { const r = new Array(19).fill(''); r[0] = D(-Math.floor(rnd() * 200)); r[2] = e; r[18] = rnd() * .5; tie.push(r); } });

  const inTraining = md.slice(1).filter(r => !r[19] && r[11] === 'Active');
  const cr = [['Request ID', 'Requested On', 'Requested By', 'Trainer', 'Emp ID', 'Employee Name', 'Change', 'Old Value', 'New Value', 'Status', 'Reviewed By', 'Reviewed On', 'Review Note', 'Data']];
  inTraining.slice(0, 3).forEach((r, i) => {
    cr.push(['CR-PREVIEW-' + (i + 1), stampOf(0), r[9], r[9], r[2], r[3], i === 2 ? 'Training Start Date' : 'Department',
      i === 2 ? '' : r[6] + ' / ' + r[7], i === 2 ? D(2) : 'Tenant Servicing / TSPP', 'Pending', '', '', '',
      i === 2 ? JSON.stringify({ date: D(2) }) : JSON.stringify({ department: 'Tenant Servicing', subTeam: 'TSPP' })]);
  });

  const tgt = [['Department', 'Team', '', '', 'OJT Duration', 'Metric', 'Metric Type', 'Weightage', 'Unit', 'W1', 'W2', 'W3', 'W4', 'Overall', 'Comment']];
  const tgtDisplay = [tgt[0].slice()];
  [['Seller Servicing', 'Seller Servicing (Closure)', 'Closure'], ['Tenant Service', 'TS/TSRP', 'Closure'], ['Owner Servicing', 'Owner Servicing (Closure)', 'NB Closure'],
    ['PnM Servicing', 'Servicing - Inbound', 'Closure'], ['Legal Services', 'Legal Servicing', 'Ops Rating'], ['Commercial Sales', 'Commercial Sales O/S', 'Closure']].forEach(([d, t, m]) => {
    tgt.push([d, t, '', '', '30 days', 'Talktime', 'Input', 40, 'Hours', '', '', '', '', '', '']);
    tgtDisplay.push([d, t, '', '', '30 days', 'Talktime', 'Input', '40', 'Hours', '20:00:00', '25:00:00', '25:00:00', '30:00:00', '100:00:00', '']);
    const r = ['', '', '', '', '', m, 'Output', 60, m === 'Ops Rating' ? 'Rating' : 'Count', 2, 3, 3, 4, m === 'Ops Rating' ? 4 : 12, ''];
    tgt.push(r); tgtDisplay.push(r.map(String));
  });

  const tracker = {
    'Master Dashboard': md, 'HR_WFO': wfo, 'HR_WFH': wfh, 'Scoring_Master': sm, 'T&D Performance Tracker': trk, 'KC Sheet': kc,
    'Intervention Required': ir, 'Tenure Intervention Effectivene': tie, 'Removed': [['']]
  };
  const appTabs = { 'Attendance': att, 'Mock Scores': mocks, 'Change Requests': cr };
  return { tracker, appTabs, targets: { values: tgt, display: tgtDisplay }, talk };
}
