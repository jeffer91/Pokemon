const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {openDatabase}=require('../src/database');
test('active own listings remain separate from sales and comparable market evidence',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'own-listings-'));const db=openDatabase(folder);
 try{
 db.recordOwnListings([{species:'Ariados',level:22,price:2900,state:'activo'}]);
 db.recordOwnListings([{species:'Ariados',level:22,price:2900,state:'activo'}]);
 assert.equal(db.ownListings().length,1);assert.equal(db.ownListings()[0].confirmedSales,0);
 assert.equal(db.candidates('Ariados').length,0);assert.equal(db.transactionHistory().length,0);
 db.addTransaction({species:'Ariados',kind:'SELL',price:2900,fee:1000});
 assert.equal(db.ownListings()[0].averageNet,1900);
 }finally{db.close();fs.rmSync(folder,{recursive:true,force:true});}
});
