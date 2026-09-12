
import { INITIAL_CAPACITY, ROTATION_ORDER_ZY_MAP } from '../constants';
import { Mat4Utils } from '../math';

export class ComponentStorage {
    capacity = INITIAL_CAPACITY;

    // --- Component Mask ---
    componentMask = new Uint32Array(this.capacity);

    // --- Transform ---
    posX = new Float32Array(this.capacity);
    posY = new Float32Array(this.capacity);
    posZ = new Float32Array(this.capacity);
    
    rotX = new Float32Array(this.capacity);
    rotY = new Float32Array(this.capacity);
    rotZ = new Float32Array(this.capacity);
    
    scaleX = new Float32Array(this.capacity);
    scaleY = new Float32Array(this.capacity);
    scaleZ = new Float32Array(this.capacity);
    
    rotationOrder = new Uint8Array(this.capacity);
    worldMatrix = new Float32Array(this.capacity * 16);
    transformDirty = new Uint8Array(this.capacity);

    // --- Mesh ---
    meshType = new Int32Array(this.capacity); 
    textureIndex = new Float32Array(this.capacity);
    materialIndex = new Int32Array(this.capacity); 
    rigIndex = new Int32Array(this.capacity);      
    effectIndex = new Float32Array(this.capacity); 
    animationIndex = new Int32Array(this.capacity); // Added
    
    colorR = new Float32Array(this.capacity);
    colorG = new Float32Array(this.capacity);
    colorB = new Float32Array(this.capacity);

    // --- Light ---
    lightType = new Uint8Array(this.capacity); 
    lightIntensity = new Float32Array(this.capacity);

    // --- Camera ---
    cameraProjection = new Uint8Array(this.capacity); // 0 perspective, 1 orthographic
    cameraFov = new Float32Array(this.capacity);
    cameraOrthoSize = new Float32Array(this.capacity);
    cameraNear = new Float32Array(this.capacity);
    cameraFar = new Float32Array(this.capacity);
    cameraClearMode = new Uint8Array(this.capacity); // 0 color, 1 sky, 2 none
    cameraClearR = new Float32Array(this.capacity);
    cameraClearG = new Float32Array(this.capacity);
    cameraClearB = new Float32Array(this.capacity);
    cameraRenderLayerMask = new Uint32Array(this.capacity);
    cameraPostProcessEnabled = new Uint8Array(this.capacity);
    cameraPostProcessProfileId: string[] = new Array(this.capacity).fill('');
    cameraPresetId: string[] = new Array(this.capacity).fill('');
    cameraConfigSource = new Uint8Array(this.capacity); // 0 local, 1 preset
    cameraControlMode = new Uint8Array(this.capacity); // 0 manual, 1 runtime, 2 cinematic

    // --- Physics ---
    mass = new Float32Array(this.capacity);
    useGravity = new Uint8Array(this.capacity);
    physicsMaterialIndex = new Int32Array(this.capacity); 

    // --- Virtual Pivot ---
    vpLength = new Float32Array(this.capacity); 

    // --- Particle System ---
    psMaxCount = new Int32Array(this.capacity);
    psRate = new Float32Array(this.capacity);
    psSpeed = new Float32Array(this.capacity);
    psLife = new Float32Array(this.capacity);
    psColorR = new Float32Array(this.capacity);
    psColorG = new Float32Array(this.capacity);
    psColorB = new Float32Array(this.capacity);
    psSize = new Float32Array(this.capacity);
    psTextureId = new Float32Array(this.capacity);
    psMaterialIndex = new Int32Array(this.capacity); // Added
    // 0: Point, 1: Cone, 2: Sphere
    psShape = new Uint8Array(this.capacity); 

    // --- Metadata ---
    isActive = new Uint8Array(this.capacity);
    generation = new Uint32Array(this.capacity);
    
    names: string[] = new Array(this.capacity);
    ids: string[] = new Array(this.capacity);
    
    constructor() {
        this.scaleX.fill(1);
        this.scaleY.fill(1);
        this.scaleZ.fill(1);
        this.vpLength.fill(1.0);
        this.cameraFov.fill(60);
        this.cameraOrthoSize.fill(10);
        this.cameraNear.fill(0.1);
        this.cameraFar.fill(1000);
        this.cameraClearMode.fill(1);
        this.cameraClearR.fill(0.125); this.cameraClearG.fill(0.145); this.cameraClearB.fill(0.176);
        this.cameraRenderLayerMask.fill(0xffffffff);
        this.cameraPostProcessEnabled.fill(1);
        this.cameraConfigSource.fill(0);
        this.cameraControlMode.fill(0);
        
        // Initialize world matrices
        for (let i = 0; i < this.capacity; i++) {
            const base = i * 16;
            this.worldMatrix[base] = 1;
            this.worldMatrix[base + 5] = 1;
            this.worldMatrix[base + 10] = 1;
            this.worldMatrix[base + 15] = 1;
        }
    }

    setPosition(index: number, x: number, y: number, z: number) {
        this.posX[index] = x; this.posY[index] = y; this.posZ[index] = z;
        this.transformDirty[index] = 1;
    }

    setRotation(index: number, x: number, y: number, z: number) {
        this.rotX[index] = x; this.rotY[index] = y; this.rotZ[index] = z;
        this.transformDirty[index] = 1;
    }

    setScale(index: number, x: number, y: number, z: number) {
        this.scaleX[index] = x; this.scaleY[index] = y; this.scaleZ[index] = z;
        this.transformDirty[index] = 1;
    }

    updateWorldMatrix(index: number, parentMatrix: Float32Array | null) {
        const base = index * 16;
        const out = this.worldMatrix.subarray(base, base + 16);
        
        const tx = this.posX[index], ty = this.posY[index], tz = this.posZ[index];
        const rx = this.rotX[index], ry = this.rotY[index], rz = this.rotZ[index];
        const sx = this.scaleX[index], sy = this.scaleY[index], sz = this.scaleZ[index];
        
        const cx = Math.cos(rx), sx_val = Math.sin(rx);
        const cy = Math.cos(ry), sy_val = Math.sin(ry);
        const cz = Math.cos(rz), sz_val = Math.sin(rz);

        let r00, r01, r02, r10, r11, r12, r20, r21, r22;
        const order = this.rotationOrder[index];

        // Default XYZ
        const m00 = cy * cz;
        const m01 = cz * sx_val * sy_val - cx * sz_val;
        const m02 = cx * cz * sy_val + sx_val * sz_val;
        const m10 = cy * sz_val;
        const m11 = cx * cz + sx_val * sy_val * sz_val;
        const m12 = -cz * sx_val + cx * sy_val * sz_val;
        const m20 = -sy_val;
        const m21 = cy * sx_val;
        const m22 = cx * cy;
        
        if (order === 0) {
            r00=m00; r01=m01; r02=m02; r10=m10; r11=m11; r12=m12; r20=m20; r21=m21; r22=m22;
        } else if (order === 1) { // XZY
            r00 = cy * cz; r01 = -sz_val; r02 = cz * sy_val;
            r10 = sx_val * sy_val + cx * cy * sz_val; r11 = cx * cz; r12 = cx * sy_val * sz_val - cy * sx_val;
            r20 = cy * sx_val * sz_val - cx * sy_val; r21 = cz * sx_val; r22 = cx * cy + sx_val * sy_val * sz_val;
        } else {
            // Fallback
            r00=m00; r01=m01; r02=m02; r10=m10; r11=m11; r12=m12; r20=m20; r21=m21; r22=m22;
        }

        out[0] = r00 * sx; out[1] = r10 * sx; out[2] = r20 * sx; out[3] = 0;
        out[4] = r01 * sy; out[5] = r11 * sy; out[6] = r21 * sy; out[7] = 0;
        out[8] = r02 * sz; out[9] = r12 * sz; out[10] = r22 * sz; out[11] = 0;
        out[12] = tx; out[13] = ty; out[14] = tz; out[15] = 1;

        if (parentMatrix) {
            Mat4Utils.multiply(parentMatrix, out, out);
        }
        
        this.transformDirty[index] = 0;
    }

    resize(newCapacity: number) {
        console.log(`[ECS] Resizing to ${newCapacity}`);
        
        const resizeFloat = (old: Float32Array) => { const n = new Float32Array(newCapacity); n.set(old); return n; };
        const resizeInt32 = (old: Int32Array) => { const n = new Int32Array(newCapacity); n.set(old); return n; };
        const resizeUint8 = (old: Uint8Array) => { const n = new Uint8Array(newCapacity); n.set(old); return n; };
        const resizeUint32 = (old: Uint32Array) => { const n = new Uint32Array(newCapacity); n.set(old); return n; };

        this.componentMask = resizeUint32(this.componentMask);

        this.posX = resizeFloat(this.posX); this.posY = resizeFloat(this.posY); this.posZ = resizeFloat(this.posZ);
        this.rotX = resizeFloat(this.rotX); this.rotY = resizeFloat(this.rotY); this.rotZ = resizeFloat(this.rotZ);
        this.scaleX = resizeFloat(this.scaleX); this.scaleY = resizeFloat(this.scaleY); this.scaleZ = resizeFloat(this.scaleZ);
        this.rotationOrder = resizeUint8(this.rotationOrder);
        
        const newWM = new Float32Array(newCapacity * 16);
        newWM.set(this.worldMatrix);
        this.worldMatrix = newWM;
        
        this.transformDirty = resizeUint8(this.transformDirty);

        this.meshType = resizeInt32(this.meshType);
        this.textureIndex = resizeFloat(this.textureIndex);
        this.materialIndex = resizeInt32(this.materialIndex);
        this.rigIndex = resizeInt32(this.rigIndex);
        this.effectIndex = resizeFloat(this.effectIndex);
        this.animationIndex = resizeInt32(this.animationIndex);
        
        this.colorR = resizeFloat(this.colorR); this.colorG = resizeFloat(this.colorG); this.colorB = resizeFloat(this.colorB);
        this.lightType = resizeUint8(this.lightType);
        this.lightIntensity = resizeFloat(this.lightIntensity);

        this.cameraProjection = resizeUint8(this.cameraProjection);
        this.cameraFov = resizeFloat(this.cameraFov);
        this.cameraOrthoSize = resizeFloat(this.cameraOrthoSize);
        this.cameraNear = resizeFloat(this.cameraNear);
        this.cameraFar = resizeFloat(this.cameraFar);
        this.cameraClearMode = resizeUint8(this.cameraClearMode);
        this.cameraClearR = resizeFloat(this.cameraClearR); this.cameraClearG = resizeFloat(this.cameraClearG); this.cameraClearB = resizeFloat(this.cameraClearB);
        this.cameraRenderLayerMask = resizeUint32(this.cameraRenderLayerMask);
        this.cameraPostProcessEnabled = resizeUint8(this.cameraPostProcessEnabled);
        this.cameraConfigSource = resizeUint8(this.cameraConfigSource);
        this.cameraControlMode = resizeUint8(this.cameraControlMode);
        const newCameraProfileIds = new Array(newCapacity).fill('');
        const newCameraPresetIds = new Array(newCapacity).fill('');
        for (let i = 0; i < this.cameraPostProcessProfileId.length; i++) {
            newCameraProfileIds[i] = this.cameraPostProcessProfileId[i];
            newCameraPresetIds[i] = this.cameraPresetId[i];
        }
        this.cameraPostProcessProfileId = newCameraProfileIds;
        this.cameraPresetId = newCameraPresetIds;

        this.mass = resizeFloat(this.mass);
        this.useGravity = resizeUint8(this.useGravity);
        this.physicsMaterialIndex = resizeInt32(this.physicsMaterialIndex);
        
        this.vpLength = resizeFloat(this.vpLength); 
        
        // Particle Resize
        this.psMaxCount = resizeInt32(this.psMaxCount);
        this.psRate = resizeFloat(this.psRate);
        this.psSpeed = resizeFloat(this.psSpeed);
        this.psLife = resizeFloat(this.psLife);
        this.psColorR = resizeFloat(this.psColorR);
        this.psColorG = resizeFloat(this.psColorG);
        this.psColorB = resizeFloat(this.psColorB);
        this.psSize = resizeFloat(this.psSize);
        this.psTextureId = resizeFloat(this.psTextureId);
        this.psMaterialIndex = resizeInt32(this.psMaterialIndex);
        this.psShape = resizeUint8(this.psShape);

        this.isActive = resizeUint8(this.isActive);
        this.generation = resizeUint32(this.generation);
        
        const newNames = new Array(newCapacity);
        const newIds = new Array(newCapacity);
        for(let i=0; i<this.capacity; i++) {
            newNames[i] = this.names[i];
            newIds[i] = this.ids[i];
        }
        this.names = newNames;
        this.ids = newIds;

        this.capacity = newCapacity;
    }

    snapshot() {
        return {
            componentMask: new Uint32Array(this.componentMask),
            posX: new Float32Array(this.posX), posY: new Float32Array(this.posY), posZ: new Float32Array(this.posZ),
            rotX: new Float32Array(this.rotX), rotY: new Float32Array(this.rotY), rotZ: new Float32Array(this.rotZ),
            scaleX: new Float32Array(this.scaleX), scaleY: new Float32Array(this.scaleY), scaleZ: new Float32Array(this.scaleZ),
            rotationOrder: new Uint8Array(this.rotationOrder),
            meshType: new Int32Array(this.meshType),
            textureIndex: new Float32Array(this.textureIndex),
            materialIndex: new Int32Array(this.materialIndex),
            rigIndex: new Int32Array(this.rigIndex),
            effectIndex: new Float32Array(this.effectIndex),
            animationIndex: new Int32Array(this.animationIndex),
            colorR: new Float32Array(this.colorR), colorG: new Float32Array(this.colorG), colorB: new Float32Array(this.colorB),
            lightType: new Uint8Array(this.lightType),
            lightIntensity: new Float32Array(this.lightIntensity),
            cameraProjection: new Uint8Array(this.cameraProjection),
            cameraFov: new Float32Array(this.cameraFov),
            cameraOrthoSize: new Float32Array(this.cameraOrthoSize),
            cameraNear: new Float32Array(this.cameraNear),
            cameraFar: new Float32Array(this.cameraFar),
            cameraClearMode: new Uint8Array(this.cameraClearMode),
            cameraClearR: new Float32Array(this.cameraClearR), cameraClearG: new Float32Array(this.cameraClearG), cameraClearB: new Float32Array(this.cameraClearB),
            cameraRenderLayerMask: new Uint32Array(this.cameraRenderLayerMask),
            cameraPostProcessEnabled: new Uint8Array(this.cameraPostProcessEnabled),
            cameraPostProcessProfileId: [...this.cameraPostProcessProfileId],
            cameraPresetId: [...this.cameraPresetId],
            cameraConfigSource: new Uint8Array(this.cameraConfigSource),
            cameraControlMode: new Uint8Array(this.cameraControlMode),
            mass: new Float32Array(this.mass),
            useGravity: new Uint8Array(this.useGravity),
            physicsMaterialIndex: new Int32Array(this.physicsMaterialIndex),
            vpLength: new Float32Array(this.vpLength), 
            
            psMaxCount: new Int32Array(this.psMaxCount),
            psRate: new Float32Array(this.psRate),
            psSpeed: new Float32Array(this.psSpeed),
            psLife: new Float32Array(this.psLife),
            psColorR: new Float32Array(this.psColorR),
            psColorG: new Float32Array(this.psColorG),
            psColorB: new Float32Array(this.psColorB),
            psSize: new Float32Array(this.psSize),
            psTextureId: new Float32Array(this.psTextureId),
            psMaterialIndex: new Int32Array(this.psMaterialIndex),
            psShape: new Uint8Array(this.psShape),

            isActive: new Uint8Array(this.isActive),
            generation: new Uint32Array(this.generation),
            names: [...this.names],
            ids: [...this.ids]
        };
    }
    
    restore(snap: any) {
        if (!snap) return;
        
        if (snap.posX && snap.posX.length > this.capacity) this.resize(snap.posX.length);
        
        if (snap.componentMask) this.componentMask.set(snap.componentMask);

        if (snap.posX) this.posX.set(snap.posX);
        if (snap.posY) this.posY.set(snap.posY);
        if (snap.posZ) this.posZ.set(snap.posZ);
        if (snap.rotX) this.rotX.set(snap.rotX);
        if (snap.rotY) this.rotY.set(snap.rotY);
        if (snap.rotZ) this.rotZ.set(snap.rotZ);
        if (snap.scaleX) this.scaleX.set(snap.scaleX);
        if (snap.scaleY) this.scaleY.set(snap.scaleY);
        if (snap.scaleZ) this.scaleZ.set(snap.scaleZ);
        if (snap.rotationOrder) this.rotationOrder.set(snap.rotationOrder);

        if (snap.meshType) this.meshType.set(snap.meshType);
        if (snap.textureIndex) this.textureIndex.set(snap.textureIndex);
        if (snap.materialIndex) this.materialIndex.set(snap.materialIndex);
        if (snap.rigIndex) this.rigIndex.set(snap.rigIndex);
        if (snap.effectIndex) this.effectIndex.set(snap.effectIndex);
        if (snap.animationIndex) this.animationIndex.set(snap.animationIndex);
        
        if (snap.colorR) this.colorR.set(snap.colorR);
        if (snap.colorG) this.colorG.set(snap.colorG);
        if (snap.colorB) this.colorB.set(snap.colorB);
        if (snap.lightType) this.lightType.set(snap.lightType);
        if (snap.lightIntensity) this.lightIntensity.set(snap.lightIntensity);
        if (snap.cameraProjection) this.cameraProjection.set(snap.cameraProjection);
        if (snap.cameraFov) this.cameraFov.set(snap.cameraFov);
        if (snap.cameraOrthoSize) this.cameraOrthoSize.set(snap.cameraOrthoSize);
        if (snap.cameraNear) this.cameraNear.set(snap.cameraNear);
        if (snap.cameraFar) this.cameraFar.set(snap.cameraFar);
        if (snap.cameraClearMode) this.cameraClearMode.set(snap.cameraClearMode);
        if (snap.cameraClearR) this.cameraClearR.set(snap.cameraClearR);
        if (snap.cameraClearG) this.cameraClearG.set(snap.cameraClearG);
        if (snap.cameraClearB) this.cameraClearB.set(snap.cameraClearB);
        if (snap.cameraRenderLayerMask) this.cameraRenderLayerMask.set(snap.cameraRenderLayerMask);
        if (snap.cameraPostProcessEnabled) this.cameraPostProcessEnabled.set(snap.cameraPostProcessEnabled);
        if (snap.cameraPostProcessProfileId) this.cameraPostProcessProfileId = [...snap.cameraPostProcessProfileId];
        if (snap.cameraPresetId) this.cameraPresetId = [...snap.cameraPresetId];
        if (snap.cameraConfigSource) {
            this.cameraConfigSource.set(snap.cameraConfigSource);
        } else if (snap.cameraPresetId) {
            // Migration for scenes saved before CameraConfigSource existed:
            // a non-empty preset reference represented the old preset/copy workflow.
            for (let i = 0; i < this.cameraPresetId.length; i++) {
                this.cameraConfigSource[i] = this.cameraPresetId[i] ? 1 : 0;
            }
        }
        if (snap.cameraControlMode) this.cameraControlMode.set(snap.cameraControlMode);
        else this.cameraControlMode.fill(0);

        if (snap.mass) this.mass.set(snap.mass);
        if (snap.useGravity) this.useGravity.set(snap.useGravity);
        if (snap.physicsMaterialIndex) this.physicsMaterialIndex.set(snap.physicsMaterialIndex);
        
        if (snap.vpLength) this.vpLength.set(snap.vpLength); 
        
        if(snap.psMaxCount) {
            this.psMaxCount.set(snap.psMaxCount);
            if (snap.psRate) this.psRate.set(snap.psRate);
            if (snap.psSpeed) this.psSpeed.set(snap.psSpeed);
            if (snap.psLife) this.psLife.set(snap.psLife);
            if (snap.psColorR) this.psColorR.set(snap.psColorR);
            if (snap.psColorG) this.psColorG.set(snap.psColorG);
            if (snap.psColorB) this.psColorB.set(snap.psColorB);
            if (snap.psSize) this.psSize.set(snap.psSize);
            if (snap.psTextureId) this.psTextureId.set(snap.psTextureId);
            if(snap.psMaterialIndex) this.psMaterialIndex.set(snap.psMaterialIndex);
            if (snap.psShape) this.psShape.set(snap.psShape);
        }

        if (snap.isActive) this.isActive.set(snap.isActive);
        if (snap.generation) this.generation.set(snap.generation);
        
        if (snap.names) this.names = [...snap.names];
        if (snap.ids) this.ids = [...snap.ids];
        
        this.transformDirty.fill(1);
    }
}
