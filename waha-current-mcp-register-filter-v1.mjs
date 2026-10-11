// WAHA Current MCP register filter v1. No filesystem or network effects.
export const WAHA_TOOL_NAMES=Object.freeze([
  'waha_student_bridge_registration_preflight_v1',
  'waha_student_bridge_registration_apply_v1'
]);
const allowed=new Set(WAHA_TOOL_NAMES);

export function registerOnlyWahaTools(mcp,context,legacyRegister){
  if(!mcp||typeof mcp.registerTool!=='function'||typeof legacyRegister!=='function'){
    throw new Error('waha_registration_invalid_inputs');
  }
  const seen=new Set();
  const proxy=new Proxy(mcp,{
    get(target,prop){
      if(prop==='registerTool'){
        return (name,...rest)=>{
          if(!allowed.has(name))return undefined;
          if(seen.has(name))throw new Error('waha_duplicate_tool_registration:'+name);
          seen.add(name);
          return target.registerTool(name,...rest);
        };
      }
      const value=Reflect.get(target,prop,target);
      return typeof value==='function'?value.bind(target):value;
    }
  });
  // Legacy registration may enumerate many SafeFiles tools. They are all dropped
  // from this second registration pass; only exactly two WAHA tools may pass.
  legacyRegister(proxy,context);
  if(seen.size!==allowed.size||WAHA_TOOL_NAMES.some(name=>!seen.has(name))){
    throw new Error('waha_registration_exact_tool_set_missing');
  }
  return Object.freeze({registered:WAHA_TOOL_NAMES.slice(),retained_existing_tools:true});
}
