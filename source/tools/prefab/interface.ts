export interface PrefabInfo {
    name: string;
    uuid: string;
    path: string;
    folder: string;
    createTime?: string;
    modifyTime?: string;
    dependencies?: string[];
}
