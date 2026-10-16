import {createCliAdapter} from '../src/adapters/cli.mjs';

// This directory and executable are chosen by the host, not by the agent.
// Register this adapter with Enlace's core router; execute does not replace policy.
export function createGitStatusAdapter(repositoryDirectory){
  return createCliAdapter({
    id:'git-status',command:'git',cwd:repositoryDirectory,
    operations:[{
      id:'status',effect:'read',requiresResearch:false,cost:3,
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      argv:()=>['--no-optional-locks','status','--porcelain'],
    }],
  });
}
