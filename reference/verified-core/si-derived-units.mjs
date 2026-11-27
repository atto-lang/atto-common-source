// Candidate reference registry only; not compiler admission or source syntax.
// Canonical SI base exponent order: Length, Mass, Time, ElectricCurrent,
// Temperature, AmountOfSubstance, LuminousIntensity.
export const baseDimensions=Object.freeze(["Length","Mass","Time","ElectricCurrent","Temperature","AmountOfSubstance","LuminousIntensity"]);
const rows=[
 ["Radian","rad",[0,0,0,0,0,0,0],"PlaneAngle"],
 ["Steradian","sr",[0,0,0,0,0,0,0],"SolidAngle"],
 ["Hertz","Hz",[0,0,-1,0,0,0,0],"Frequency"],
 ["Newton","N",[1,1,-2,0,0,0,0],"Force"],
 ["Pascal","Pa",[-1,1,-2,0,0,0,0],"Pressure"],
 ["Joule","J",[2,1,-2,0,0,0,0],"Energy"],
 ["Watt","W",[2,1,-3,0,0,0,0],"Power"],
 ["Coulomb","C",[0,0,1,1,0,0,0],"ElectricCharge"],
 ["Volt","V",[2,1,-3,-1,0,0,0],"ElectricPotential"],
 ["Farad","F",[-2,-1,4,2,0,0,0],"Capacitance"],
 ["Ohm","Ω",[2,1,-3,-2,0,0,0],"Resistance"],
 ["Siemens","S",[-2,-1,3,2,0,0,0],"Conductance"],
 ["Weber","Wb",[2,1,-2,-1,0,0,0],"MagneticFlux"],
 ["Tesla","T",[0,1,-2,-1,0,0,0],"MagneticFluxDensity"],
 ["Henry","H",[2,1,-2,-2,0,0,0],"Inductance"],
 ["DegreeCelsius","°C",[0,0,0,0,1,0,0],"TemperaturePoint","affine"],
 ["Lumen","lm",[0,0,0,0,0,0,1],"LuminousFlux"],
 ["Lux","lx",[-2,0,0,0,0,0,1],"Illuminance"],
 ["Becquerel","Bq",[0,0,-1,0,0,0,0],"RadioactiveActivity"],
 ["Gray","Gy",[2,0,-2,0,0,0,0],"AbsorbedDose"],
 ["Sievert","Sv",[2,0,-2,0,0,0,0],"DoseEquivalent"],
 ["Katal","kat",[0,0,-1,0,0,1,0],"CatalyticActivity"]
];
export const derivedSI=Object.freeze(rows.map(([name,symbol,powers,kind,model="linear"])=>Object.freeze({name,symbol,powers:Object.freeze(powers),kind,model,scale:Object.freeze([1n,1n]),offsetToKelvin:model==="affine"?Object.freeze([27315n,100n]):null})));
export function sameDimension(a,b){
 return a.powers.length===baseDimensions.length&&b.powers.length===baseDimensions.length&&a.powers.every((n,i)=>n===b.powers[i]);
}
// Conservative candidate gate: equal exponents do not authorize implicit kind
// coercion. Affine points must use a separate checked point conversion.
export function sameLinearKind(a,b){
 return a.model==="linear"&&b.model==="linear"&&sameDimension(a,b)&&a.kind===b.kind;
}
