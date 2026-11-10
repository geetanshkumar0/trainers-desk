/*
 * People added to Pick Timer from the backend, in batches. server/mount.js adds each batch once (settings.userListVersion):
 * anyone whose email is already in Pick Timer is left exactly as they are. To add more people, append a new batch
 * with the next version number. Later changes (role, name, removal) are made in Site administration > Users.
 */
'use strict';
module.exports = [
  { version: 1, role: 'trainer', users: [
    ['Rajnish Choubey', 'rajnish.choubey@nobroker.in'],
    ['Sagar Khare', 'sagar.khare@nobroker.in'],
    ['Heena Mirza', 'heena.mirza@nobroker.in'],
    ['Abhijeet Patel', 'abhijeet.patel@nobroker.in'],
    ['A Shalini', 'shalini.a@nobroker.in'],
    ['BILLUR FAKRUDDIN SAB AMZAD', 'amzad.bf@nobroker.in'],
    ['Sonika', 'sonika.venugopal@nobroker.in'],
    ['Nithya', 'nithya.theagraj@nobroker.in'],
    ['Preetham Kumari', 'preetham.kumari@nobroker.in'],
    ['Johnson.B', 'johnson.b@nobroker.in'],
    ['Shreelakshmi K', 'shreelakshmi.k@nobroker.in'],
    ['Ayesha Begum', 'ayesha.begum@nobroker.in'],
    ['Swarusha M', 'swarusha.m@nobroker.in'],
    ['Mani Reddy', 'mani.kanta@nobroker.in'],
    ['Sweety Chandrapaul', 'sweety.chandrapaul@nobroker.in'],
  ] },
];
