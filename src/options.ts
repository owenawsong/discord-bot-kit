import type { CommandOption, Input } from './types.js';
export class OptionFault extends Error {
  readonly remedy='Match the declared command options. Validate required values, types, choices and bounds before handler side effects.';
  constructor(readonly code:string,message:string) {super(message);}
}
export function validateOptionSchema(options:CommandOption[]=[]) {
  if(!Array.isArray(options)||options.length>25)throw new Error('Commands support at most 25 options');
  const names=new Set<string>();
  for(const o of options) {
    if(!o||! /^[a-z][a-z0-9_-]{0,31}$/.test(o.name)||names.has(o.name)||typeof o.description!=='string'||o.description.length<1||o.description.length>100||!['string','number','integer','boolean','user','channel'].includes(o.type)||(o.required!==undefined&&typeof o.required!=='boolean'))throw new Error(`Invalid or duplicate command option: ${o?.name}`);
    names.add(o.name);
    if(o.min!==undefined||o.max!==undefined) {
      if(!['number','integer'].includes(o.type)||[o.min,o.max].some(v=>v!==undefined&&(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER||(o.type==='integer'&&!Number.isSafeInteger(v))))||(o.min!==undefined&&o.max!==undefined&&o.min>o.max))throw new Error(`Invalid numeric bounds for ${o.name}`);
    }
    if(o.minLength!==undefined||o.maxLength!==undefined) {
      if(o.type!=='string'||[o.minLength,o.maxLength].some(v=>v!==undefined&&(!Number.isInteger(v)||v<0||v>6000))||o.maxLength===0||(o.minLength!==undefined&&o.maxLength!==undefined&&o.minLength>o.maxLength))throw new Error(`Invalid string bounds for ${o.name}`);
    }
    if(o.choices) {
      if(!['string','number','integer'].includes(o.type)||!Array.isArray(o.choices)||o.choices.length<1||o.choices.length>25||new Set(o.choices.map(c=>c.value)).size!==o.choices.length||o.choices.some(c=>!c||typeof c.name!=='string'||c.name.length<1||c.name.length>100||(o.type==='string'?(typeof c.value!=='string'||c.value.length<1||c.value.length>100):(typeof c.value!=='number'||!Number.isFinite(c.value)||Math.abs(c.value)>Number.MAX_SAFE_INTEGER||(o.type==='integer'&&!Number.isSafeInteger(c.value))))))throw new Error(`Invalid choices for ${o.name}`);
    }
  }
}
export function validateArguments(options:CommandOption[]=[],args:Input['args']={}) {
  if(!args||typeof args!=='object'||Array.isArray(args))throw new OptionFault('GW_ARGUMENT_TYPE','Command arguments must be an object.');
  const declared=new Map(options.map(o=>[o.name,o]));
  for(const key of Object.keys(args))if(!declared.has(key))throw new OptionFault('GW_ARGUMENT_UNKNOWN',`Unknown command option: ${key}.`);
  for(const o of options) {
    const value=Object.hasOwn(args,o.name)?args[o.name]:undefined;
    if(value===undefined){if(o.required)throw new OptionFault('GW_ARGUMENT_REQUIRED',`Missing required option: ${o.name}.`);continue;}
    const valid=o.type==='boolean'?typeof value==='boolean':o.type==='number'||o.type==='integer'?typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER&&(o.type!=='integer'||Number.isSafeInteger(value)):typeof value==='string'&&(o.type==='string'||/^\d{17,22}$/.test(value));
    if(!valid)throw new OptionFault('GW_ARGUMENT_TYPE',`${o.name} must be a ${o.type}${o.type==='user'||o.type==='channel'?' ID':''}.`);
    if(typeof value==='number'&&((o.min!==undefined&&value<o.min)||(o.max!==undefined&&value>o.max)))throw new OptionFault('GW_ARGUMENT_RANGE',`${o.name} is outside its declared numeric bounds.`);
    if(o.type==='string'&&typeof value==='string'&&(value.length<(o.minLength??0)||value.length>(o.maxLength??6000)))throw new OptionFault('GW_ARGUMENT_RANGE',`${o.name} is outside its declared text length bounds.`);
    if(o.choices&&!o.choices.some(c=>c.value===value))throw new OptionFault('GW_ARGUMENT_CHOICE',`${o.name} must be one of its declared choices.`);
  }
  return structuredClone(args);
}
