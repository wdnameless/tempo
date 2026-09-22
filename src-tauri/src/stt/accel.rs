//! Compute accelerators and hardware device enumeration for Whisper inference.

use serde::{Deserialize, Serialize};
use transcribe_cpp::{devices, Device, DeviceType};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcceleratorInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub device_type: String,
    pub memory_total: u64,
    pub memory_free: u64,
    pub is_cpu: bool,
}

pub fn device_key(d: &Device) -> String {
    d.device_id.clone().unwrap_or_else(|| d.name.clone())
}

pub fn device_label(d: &Device) -> String {
    if d.description.is_empty() {
        d.name.clone()
    } else {
        d.description.clone()
    }
}

/// Enumerates all available compute accelerators registered with transcribe-cpp.
pub fn accelerators() -> Vec<AcceleratorInfo> {
    devices()
        .into_iter()
        .map(|d| {
            let id = device_key(&d);
            let name = device_label(&d);
            let is_cpu = matches!(d.device_type, DeviceType::Cpu)
                || d.kind.eq_ignore_ascii_case("cpu");
            let device_type = match d.device_type {
                DeviceType::Cpu => "cpu",
                DeviceType::Gpu => "gpu",
                DeviceType::Igpu => "igpu",
                DeviceType::Accel => "accel",
                DeviceType::Unknown => "unknown",
            }
            .to_string();

            AcceleratorInfo {
                id,
                name,
                kind: d.kind,
                device_type,
                memory_total: d.memory_total,
                memory_free: d.memory_free,
                is_cpu,
            }
        })
        .collect()
}

/// Resolves an exact compute device by its stable identifier or name.
pub fn resolve_gpu_device(device_id: Option<&str>) -> Option<Device> {
    let target = device_id?.trim();
    if target.is_empty() {
        return None;
    }
    devices().into_iter().find(|d| {
        let key = device_key(d);
        key.eq_ignore_ascii_case(target)
            || d.name.eq_ignore_ascii_case(target)
            || d.description.eq_ignore_ascii_case(target)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accelerators_enumeration_does_not_panic() {
        let list = accelerators();
        // transcribe-cpp always provides at least CPU device in static build
        for acc in &list {
            assert!(!acc.id.is_empty());
            assert!(!acc.name.is_empty());
            assert!(!acc.device_type.is_empty());
        }
    }
}
