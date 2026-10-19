"""Two-process contract fixture. Does not run or emulate trained ML models."""
import os
import time
import numpy as np
from uma_fixture_bridge import b, packages


class Delta:
    def __init__(self,data,config,directory):
        self.data,self.config,self.calls=data,config,0
        device=config['solvation']['device']
        assert os.environ['CUDA_VISIBLE_DEVICES']==({'cpu':'','cuda:0':'3','cuda:1':'GPU-test-uuid'}[device])
        assert config['anysolvRuntimeDevice']==('cpu' if device=='cpu' else 'cuda')

    def __call__(self,index,p):
        self.calls+=1
        solvent=self.config['solvation']['solvent']
        if solvent=='failure' and self.calls>1:raise RuntimeError('hf_private_token /private/path')
        time.sleep(.03 if solvent!='slow' else 15)
        factor=.25 if solvent=='water' else .125
        return -factor*(p*p).sum()-2,2*factor*p


def catalog(config,checkpoint=None):
    config.update(anysolvPaths={'model_compact':'/private/model.pt','model_moe':'/private/moe.pt'},
                  anysolvHashes={'model_compact':'a'*64,'model_moe':'b'*64},anysolvSolvents=['water','ethanol','failure','slow'])


def uma_packages(config):
    result=packages(config)
    original=result[2].get_predict_unit
    def predictor(*args,**kwargs):
        assert kwargs['device']==('cpu' if config['umaDevice']=='cpu' else 'cuda')
        assert os.environ['CUDA_VISIBLE_DEVICES']=={'cpu':'','cuda:0':'3','cuda:1':'GPU-test-uuid'}[config['umaDevice']]
        return original(*args,**kwargs)
    result[2].get_predict_unit=predictor
    return result


b.AnySolvEngine=Delta
b.anysolv_catalog=catalog
b.uma_packages=uma_packages
b.device_inventory=lambda torch: ([{'id':d,'label':d} for d in ('cpu','cuda:0','cuda:1')],{'cuda:0':'3','cuda:1':'GPU-test-uuid'})

if __name__=='__main__':
    b.mp.freeze_support()
    b.main()
