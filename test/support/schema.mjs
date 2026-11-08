function schema(type, dict) {
 const value = x => x
 value.type = type
 value.dict = dict
 value.meta = {}
 for (const key of ['step', 'min', 'max', 'required', 'description']) value[key] = () => value
 value.default = x => { value.meta.default = x; return value }
 value.volatile = () => { value.meta.volatile = true; return value }
 return value
}
export default { object: dict => schema('object', dict), array: inner => schema('array', inner), string: () => schema('string'), number: () => schema('number'), boolean: () => schema('boolean'), any: () => schema('any') }
