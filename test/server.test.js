const test = require('node:test');
const assert = require('node:assert/strict');
const { validBlock, safeRoom } = require('../server');

test('validBlock aceita coordenadas e materiais permitidos', () => {
  assert.equal(validBlock({x:0,y:1,z:-2,type:'grass'}), true);
});
test('validBlock rejeita coordenadas inválidas e tipo desconhecido', () => {
  assert.equal(validBlock({x:999,y:1,z:0,type:'grass'}), false);
  assert.equal(validBlock({x:0,y:1,z:0,type:'lava'}), false);
  assert.equal(validBlock({x:0.5,y:1,z:0,type:'stone'}), false);
});
test('safeRoom normaliza nomes inválidos', () => {
  assert.equal(safeRoom('ilha_01'), 'ilha_01');
  assert.equal(safeRoom('../admin'), 'wildlands-public');
});
