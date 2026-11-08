'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {refineScan,applyDigitReads,createDigitBook,classifyCell}=require('../src/cell-reader');
const {fuzzyNature}=require('../src/recognition');

// Tiny 3×5 pixel font, scaled ×3, drawn like the GTL: white digits, green 31.
const FONT={0:['111','101','101','101','111'],1:['010','110','010','010','111'],
  2:['111','001','111','100','111'],3:['111','001','111','001','111'],4:['101','101','111','001','001'],
  5:['111','100','111','001','111'],6:['111','100','111','101','111'],7:['111','001','010','010','010'],
  8:['111','101','111','101','111'],9:['111','101','111','001','111']};
const W=1000,H=500,S=3;
function canvas(){
  const b=Buffer.alloc(W*H*4);
  for(let i=0;i<W*H;i++){b[i*4]=95;b[i*4+1]=75;b[i*4+2]=60;b[i*4+3]=255;}
  return b;
}
function draw(b,text,cx,cy,green=false){
  const width=text.length*3*S+(text.length-1)*S;
  let x0=Math.round(cx-width/2);const y0=Math.round(cy-2.5*S);
  for(const ch of text){
    FONT[ch].forEach((row,ry)=>[...row].forEach((on,rx)=>{
      if(on!=='1')return;
      for(let dy=0;dy<S;dy++)for(let dx=0;dx<S;dx++){
        const k=((y0+ry*S+dy)*W+x0+rx*S+dx)*4;
        if(green){b[k]=70;b[k+1]=200;b[k+2]=80;}else{b[k]=235;b[k+1]=235;b[k+2]=235;}
      }
    }));
    x0+=4*S;
  }
}
const ivCenters=[.40,.44,.48,.52,.56,.60],rowCenters=Array.from({length:10},(_,i)=>.05+.045*i);
const cells={panel:{x:0,y:0,width:W},crop:{x:0,y:0,width:W,height:H},ivCenters,ivHalf:.018,rowCenters,rowHalf:.0115,
  cols:{name:[.078,.292],nature:[.292,.356],price:[.557,.675]}};
const at=(rank,j)=>[ivCenters[j]*W,rowCenters[rank-1]*W];
function row(rank,ivs,extra={}){
  return {species:'Gible',level:1,nature:'alegre',sex:'F',price:5000,ivs,rank,
    ivConf:ivs.map(v=>v===null?0:95),...extra};
}

test('green cells are 31, learned digits fill gaps and fix a white "31"',()=>{
  const b=canvas();
  const truth1=[12,25,7,30,14,3],truth2=['31g','25','7','14','9','21'];
  truth1.forEach((v,j)=>draw(b,String(v),...at(1,j)));
  truth2.forEach((v,j)=>draw(b,v.replace('g',''),...at(2,j),v.endsWith('g')));
  const parsed={rows:[{...row(1,truth1),ocrReliable:true}],
    partialRows:[{...row(2,[null,null,7,14,null,31],{ivConf:[0,0,95,95,0,60]}),missingFields:['IV_PS','IV_ATAQUE','IV_DEFENSA_ESP'],priceReliable:true}],
    cells};
  const book=createDigitBook();
  const {parsed:out,pending,stats}=refineScan(parsed,{bitmap:b,width:W,height:H},book);
  assert.ok(stats.learned>=6,'learns digits from confident cells');
  const r2=out.partialRows.find(r=>r.rank===2);
  assert.equal(r2.ivs[0],31);           // green
  assert.equal(r2.ivs[1],25);           // template
  assert.equal(r2.ivs[5],21);           // white "31" corrected
  assert.equal(r2.ivs[4],null);         // 9 never learned → digits OCR
  assert.deepEqual(pending.map(p=>[p.rank,p.j]),[[2,4]]);
  const done=applyDigitReads(out,[{rank:2,j:4,value:9}]);
  const complete=done.rows.find(r=>r.rank===2);
  assert.deepEqual(complete.ivs,[31,25,7,14,9,21]);
  assert.equal(complete.ocrReliable,true);
  assert.equal(done.diagnosticRows[1].state,'complete');
});

test('digit book persists and refuses to guess before it knows enough digits',()=>{
  const book=createDigitBook();
  const g={bits:Array(54).fill(1),aspect:3};
  assert.equal(book.match([g]),null);
  const copy=createDigitBook(JSON.parse(JSON.stringify(book.toJSON())));
  assert.equal(copy.size(),0);
  const b=canvas();draw(b,'7',100,100);
  const c=classifyCell(b,W,H,{x:80,y:85,width:40,height:30});
  assert.equal(c.glyphs.length,1);assert.ok(c.white>20);
});

test('without detectable green the colour rule never erases 31s',()=>{
  const b=canvas();
  [31,31,4,5,6,7].forEach((v,j)=>draw(b,String(v),...at(1,j)));
  const parsed={rows:[{...row(1,[31,31,4,5,6,7]),ocrReliable:true}],partialRows:[],cells};
  const {parsed:out}=refineScan(parsed,{bitmap:b,width:W,height:H},createDigitBook());
  assert.deepEqual(out.rows[0].ivs,[31,31,4,5,6,7]);
});

test('natures tolerate one OCR mistake but never guess between two',()=>{
  assert.equal(fuzzyNature('rnansa'.replace('rn','m')),'mansa');
  assert.equal(fuzzyNature('alegra'),'alegre');
  assert.equal(fuzzyNature('timlda'),'timida');
  assert.equal(fuzzyNature('xx'),null);
});

test('names survive split dots, junk borders and dropped levels',()=>{
  const {parseNameCell}=require('../src/recognition');
  assert.deepEqual(parseNameCell('Nv. 100 Garchomp'),{level:100,species:'Garchomp'});
  assert.deepEqual(parseNameCell('Nv .51 Garchomp'),{level:51,species:'Garchomp'});
  assert.deepEqual(parseNameCell('Nv . 100 Garchomp'),{level:100,species:'Garchomp'});
  assert.deepEqual(parseNameCell('| Nv. 1 Gligar É'),{level:1,species:'Gligar'});
  assert.deepEqual(parseNameCell('— Nv.40Gligar E'),{level:40,species:'Gligar'});
  assert.deepEqual(parseNameCell('Nv Garchomp'),{level:null,species:'Garchomp'});
});

test('a nature cut on the left is recovered only when unique',()=>{
  assert.equal(fuzzyNature('egre'),'alegre');
  assert.equal(fuzzyNature('legre'),'alegre');
  assert.equal(fuzzyNature('El'),null);
});

test('text cells of partial rows are re-read and applied',()=>{
  const {pendingTextCells,applyTextReads}=require('../src/cell-reader');
  const parsed={rows:[],partialRows:[{species:'Garchomp',level:null,nature:'el',sex:'F',price:235111,
    ivs:[31,31,26,27,7,31],rank:9,priceReliable:true,missingFields:['NIVEL','NATURALEZA']}],cells,visibleRows:10};
  const cellsToRead=pendingTextCells(parsed,{width:W,height:H});
  assert.deepEqual(cellsToRead.map(c=>c.field),['name','nature']);
  const out=applyTextReads(parsed,[{rank:9,field:'name',value:{species:'Garchomp',level:68}},
    {rank:9,field:'nature',value:'alegre'}]);
  assert.equal(out.rows.length,1);
  assert.equal(out.rows[0].level,68);
  assert.equal(out.diagnosticRows[8].state,'complete');
});

test('the footer marks empty rows and the last page',()=>{
  const {diagnosticRowsFor}=require('../src/cell-reader');
  const rows=diagnosticRowsFor([{rank:1,species:'Gligar',ivs:[31,31,31,31,31,31],ocrReliable:true}],[],2);
  assert.equal(rows[0].state,'complete');
  assert.equal(rows[1].state,'missing');
  assert.equal(rows[2].state,'empty');
});
