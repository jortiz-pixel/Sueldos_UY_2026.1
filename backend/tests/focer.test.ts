/**
 * FOCER — FORMATO DE ANCHO FIJO (distancias/columnas)
 *
 * Fija byte a byte las POSICIONES y ANCHOS de cada campo del archivo FOCER,
 * validados contra la declaración real de GNS. Datos SINTÉTICOS (sin PII).
 * Si alguien cambia una columna en focer.service.ts, este test lo detecta.
 */
import {
  buildFocerReg1, buildFocerReg2, buildFocerReg4, buildFocerReg6, ensamblarFocer,
  FocerEmpresaLinea, FocerEmpleadoLinea,
} from '../src/services/focer.service';

const empresa: FocerEmpresaLinea = {
  bps: '5667352', rut: '216338550010', razonSocial: 'EMPRESA DE PRUEBA SA',
  domicilio: 'CALLE FALSA 123', departamento: 'Montevideo', telefono: '099111222',
  gestoria: 'ESTUDIO X', email: 'test@estudio.com', focerCodigo: 'ABC12345',
  month: 5, year: 2026, cantidad: 1, totGravado: 852557n, totFocer: 42628n,
};

// Fechas con constructor LOCAL para que ddmmaaaa no dependa de la zona horaria.
const emp: FocerEmpleadoLinea = {
  tipoDoc: 'DO', doc: '39913959', apellido: 'PEREZ', apellido2: 'GOMEZ',
  nombre: 'JUAN', nombre2: 'CARLOS', fechaNacimiento: new Date(1975, 5, 15),
  sexoF: false, jornales: 2, gravadoJornales: 674228n, restoGravado: 178329n,
  materiaGravada: 852557n, focer: 42628n, focerTipo: 2, focerTipoContrato: 1,
  direccion: 'CANELONES', departamento: 'Canelones', telefono: '099192880',
  fechaIngreso: new Date(2026, 4, 5),
};

const r1 = buildFocerReg1(empresa);
const r2 = buildFocerReg2(empresa);
const r4 = buildFocerReg4(emp);
const r6 = buildFocerReg6(emp);

describe('FOCER — longitudes de línea', () => {
  test('registro 1 = 219', () => expect(r1.length).toBe(219));
  test('registro 2 = 100', () => expect(r2.length).toBe(100));
  test('registro 4 = 219', () => expect(r4.length).toBe(219));
  test('registro 6 = 155', () => expect(r6.length).toBe(155));
});

describe('FOCER — registro 1 (empresa)', () => {
  test('tipo', () => expect(r1[0]).toBe('1'));
  test('BPS [1,15)', () => expect(r1.slice(1, 15)).toBe('5667352'.padEnd(14)));
  test('RUT [15,29)', () => expect(r1.slice(15, 29)).toBe('216338550010'.padEnd(14)));
  test('razón social [29,69)', () => expect(r1.slice(29, 69)).toBe('EMPRESA DE PRUEBA SA'.padEnd(40)));
  test('domicilio [69,149)', () => expect(r1.slice(69, 149)).toBe('CALLE FALSA 123'.padEnd(80)));
  test('departamento [149,169)', () => expect(r1.slice(149, 169)).toBe('Montevideo'.padEnd(20)));
  test('teléfono [169,184)', () => expect(r1.slice(169, 184)).toBe('099111222'.padEnd(15)));
  test('gestoría [184,219)', () => expect(r1.slice(184, 219)).toBe('ESTUDIO X'.padEnd(35)));
});

describe('FOCER — registro 2 (cabezal)', () => {
  test('tipo', () => expect(r2[0]).toBe('2'));
  test('email [1,51)', () => expect(r2.slice(1, 51)).toBe('test@estudio.com'.padEnd(50)));
  test('código FOCER [51,59)', () => expect(r2.slice(51, 59)).toBe('ABC12345'));
  test('período [61,67)', () => expect(r2.slice(61, 67)).toBe('052026'));
  test('cantidad rjust → col 70', () => expect(r2.slice(67, 71)).toBe('   1'));
  test('total gravado rjust → col 84', () => expect(r2.slice(73, 85)).toBe('     8525.57'));
  test('total FOCER rjust → col 99', () => expect(r2.slice(86, 100)).toBe('        426.28'));
});

describe('FOCER — registro 4 (empleado)', () => {
  test('tipo + país', () => { expect(r4[0]).toBe('4'); expect(r4[3]).toBe('1'); });
  test('tipo doc [4,6)', () => expect(r4.slice(4, 6)).toBe('DO'));
  test('documento [6,20)', () => expect(r4.slice(6, 20)).toBe('39913959'.padEnd(14)));
  test('apellido1 [22,52)', () => expect(r4.slice(22, 52)).toBe('PEREZ'.padEnd(30)));
  test('apellido2 [52,82)', () => expect(r4.slice(52, 82)).toBe('GOMEZ'.padEnd(30)));
  test('nombre1 [82,112)', () => expect(r4.slice(82, 112)).toBe('JUAN'.padEnd(30)));
  test('nombre2 [112,142)', () => expect(r4.slice(112, 142)).toBe('CARLOS'.padEnd(30)));
  test('nacimiento [142,150)', () => expect(r4.slice(142, 150)).toBe('15061975'));
  test('sexo (151)', () => expect(r4[151]).toBe('1'));
  test('bloque fijo 1 1 198 2', () => {
    expect(r4[153]).toBe('1');
    expect(r4[155]).toBe('1');
    expect(r4.slice(157, 160)).toBe('198');
    expect(r4[161]).toBe('2');
  });
  test('jornales rjust → col 164', () => expect(r4.slice(163, 165)).toBe(' 2'));
  test('gravado jornales rjust → col 174', () => expect(r4.slice(165, 175)).toBe('   6742.28'));
  test('resto gravado rjust → col 184', () => expect(r4.slice(175, 185)).toBe('   1783.29'));
  test('total gravado rjust → col 194', () => expect(r4.slice(185, 195)).toBe('   8525.57'));
  test('FOCER rjust → col 204', () => expect(r4.slice(195, 205)).toBe('    426.28'));
  test('tipo FOCER (206) y tipo contrato (208)', () => { expect(r4[206]).toBe('2'); expect(r4[208]).toBe('1'); });
  test('cierre 0.00 [215,219)', () => expect(r4.slice(215, 219)).toBe('0.00'));
});

describe('FOCER — registro 6 (contacto del trabajador)', () => {
  test('tipo + país + doc', () => {
    expect(r6[0]).toBe('6');
    expect(r6[3]).toBe('1');
    expect(r6.slice(4, 6)).toBe('DO');
    expect(r6.slice(6, 20)).toBe('39913959'.padEnd(14));
  });
  test('dirección [22,102)', () => expect(r6.slice(22, 102)).toBe('CANELONES'.padEnd(80)));
  test('departamento [102,117)', () => expect(r6.slice(102, 117)).toBe('Canelones'.padEnd(15)));
  test('teléfono [117,132)', () => expect(r6.slice(117, 132)).toBe('099192880'.padEnd(15)));
  test('fecha ingreso [147,155)', () => expect(r6.slice(147, 155)).toBe('05052026'));
});

describe('FOCER — ensamblado del archivo', () => {
  const archivo = ensamblarFocer(r1, r2, [r4], [r6]);
  test('empieza y termina con delimitadores', () => {
    expect(archivo.startsWith('<FOCERINI>\r\n')).toBe(true);
    expect(archivo.endsWith('\r\n<FOCERFIN>')).toBe(true);
  });
  test('líneas separadas por CRLF', () => {
    const lineas = archivo.split('\r\n');
    expect(lineas).toEqual(['<FOCERINI>', r1, r2, r4, r6, '<FOCERFIN>']);
  });
  test('jornales en blanco cuando no trabajó', () => {
    const sinJornal = buildFocerReg4({ ...emp, jornales: null, gravadoJornales: 0n, restoGravado: 0n, materiaGravada: 0n, focer: 0n });
    expect(sinJornal.slice(163, 165)).toBe('  ');
    expect(sinJornal.slice(165, 175)).toBe('      0.00');
  });
});
