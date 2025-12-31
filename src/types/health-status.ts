export enum HealthStatus {
    Healthy = 'Healthy',
    Stalled = 'Stalled',
    Recovered = 'Recovered',
    Unknown = 'Unknown'
}

export function isValidHealthStatus(value: string): value is HealthStatus {
    return Object.values(HealthStatus).includes(value as HealthStatus);
}
