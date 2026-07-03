#pragma once

#include "fh6/audio_source.hpp"
#include "fh6/config.hpp"
#include "fh6/playback_dsp.hpp"
#include "fh6/ring_buffer.hpp"
#include "fh6/worker/worker_client.hpp"

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace fh6::sources {

struct PlexTrack {
    std::string key;
    std::string title;
    std::string artist;
    std::string album;
    std::string thumb;
    std::uint64_t duration_ms = 0;
    std::size_t original_index = 0;
};

class PlexSource final : public IAudioSource {
public:
    PlexSource(PlexConfig cfg, std::filesystem::path ffmpeg_path,
               worker::WorkerClient* worker = nullptr);
    ~PlexSource() override;

    std::string_view name() const noexcept override { return "plex"; }
    std::string_view display_name() const noexcept override { return "Plex"; }

    bool initialize() override;
    bool shuffle() const { std::scoped_lock lk{mu_}; return cfg_.shuffle; }
    void shutdown() noexcept override;

    void play() override;
    void pause() override;
    void stop() override;
    void next() override;
    void previous() override;
    void pump(RingBuffer& ring) override;

    void set_config(PlexConfig cfg);
    void set_ffmpeg_path(std::filesystem::path p);

    void set_active_station(std::string name);
    void set_shuffle(bool shuffle);
    std::size_t station_count() const noexcept;
    std::string active_station_name() const;

    struct QueueEntry {
        std::size_t index;
        std::string title;
        std::string artist;
        std::string album;
    };
    struct QueueSnapshot {
        std::size_t cursor;
        std::vector<QueueEntry> entries;
    };

    QueueSnapshot queue_snapshot() const;
    bool jump_to(std::size_t index);

    bool cast(std::string target_type, std::string target_id);

    std::string fetch_directory(const std::string& type) const;

    void set_playback_options(const PlaybackConfig& opts) override;

    TrackInfo current_track() const override;
    PlaybackState playback_state() const noexcept override {
        return state_.load(std::memory_order_acquire);
    }
    AuthState auth_state() const noexcept override;
    SourceCapabilities capabilities() const noexcept override { return {false, true, true}; }

private:
    struct Pipe;

    // mu_ held
    bool refresh_queue_locked();
    std::unique_ptr<Pipe> spawn_pipe_locked(std::size_t for_idx);
    void start_pipe_locked();
    void stop_pipe_locked();
    void discard_prefetch_locked() noexcept;
    bool promote_prefetch_locked(std::size_t expected_idx);
    void maybe_spawn_prefetch_locked();
    std::size_t next_queue_idx_locked() const noexcept;
    void advance_locked(std::ptrdiff_t step);

    const PlexStation* active_station_locked() const noexcept;

    PlexConfig cfg_;
    std::filesystem::path ffmpeg_path_;
    worker::WorkerClient* worker_;

    mutable std::mutex mu_;
    std::string cast_target_type_;
    std::string cast_target_id_;
    std::vector<PlexTrack> queue_;
    std::size_t current_idx_ = 0;
    std::unique_ptr<Pipe> pipe_;
    std::unique_ptr<Pipe> prefetch_;
    std::atomic<PlaybackState> state_{PlaybackState::stopped};

    EqualizerStage eq_;
    std::atomic<bool> volume_norm_{false};
    std::atomic<bool> prebuffer_next_{true};
};

} // namespace fh6::sources
